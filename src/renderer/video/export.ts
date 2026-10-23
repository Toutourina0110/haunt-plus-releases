import { applyPalette, GIFEncoder, quantize } from 'gifenc';
import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  CanvasSink,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  StreamTarget,
  UrlSource,
  type StreamTargetChunk,
  type WrappedCanvas,
} from 'mediabunny';
import { CH } from '../../shared/channels';
import type { Clip, MediaItem, Project } from '../../shared/types';
import { desk } from '../common';
import { activeClip, clipEnd, duration, even, mediaOf, typeOf, volumeAt } from './project';
import { renderFrame, type FrameSource } from './render';

export interface ExportOptions {
  width: number;
  height: number;
  fps: number;
  targetMB: number | null;
  onProgress: (ratio: number) => void;
  signal: AbortSignal;
}

const RATE = 48000;
const AUDIO_BITRATE = 160000;
const MIX_SECONDS = 20;

function call<T>(op: string, data: Record<string, unknown> = {}): Promise<T> {
  return desk.invoke<T>(CH.videoCall, { op, ...data });
}

function cancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
}

class Inputs {
  private readonly map = new Map<string, Input>();
  of(m: MediaItem): Input {
    let input = this.map.get(m.id);
    if (!input) {
      input = new Input({ source: new UrlSource(m.url), formats: ALL_FORMATS });
      this.map.set(m.id, input);
    }
    return input;
  }
  dispose(): void {
    this.map.forEach((i) => i.dispose());
  }
}

async function renderFrames(
  p: Project,
  canvas: OffscreenCanvas,
  fps: number,
  inputs: Inputs,
  signal: AbortSignal,
  onFrame: (t: number, f: number, frames: number) => Promise<void>,
): Promise<void> {
  const total = duration(p);
  const frames = Math.max(1, Math.ceil(total * fps));
  const ctx = canvas.getContext('2d', { willReadFrequently: false })!;

  const plan = new Map<string, number[]>();
  for (let f = 0; f < frames; f++) {
    for (const track of p.tracks) {
      if (track.kind !== 'video') continue;
      const clip = activeClip(track, f / fps);
      if (!clip || typeOf(clip) !== 'media' || mediaOf(p, clip)?.kind !== 'video') continue;
      const list = plan.get(clip.id) ?? [];
      list.push(f);
      plan.set(clip.id, list);
    }
  }
  const iterators = new Map<string, AsyncGenerator<WrappedCanvas | null, void, unknown>>();
  const images = new Map<string, ImageBitmap>();
  const frameOf = async (clip: Clip, media: MediaItem): Promise<FrameSource | null> => {
    let it = iterators.get(clip.id);
    if (!it) {
      const [track] = await inputs.of(media).getVideoTracks();
      if (!track) return null;
      const times = (plan.get(clip.id) ?? []).map((f) => clip.in + (f / fps - clip.start) * clip.speed);
      it = new CanvasSink(track, { poolSize: 2 }).canvasesAtTimestamps(times);
      iterators.set(clip.id, it);
    }
    const next = await it.next();
    const wrapped = next.done ? null : next.value;
    return wrapped ? { image: wrapped.canvas, width: wrapped.canvas.width, height: wrapped.canvas.height } : null;
  };

  try {
    for (let f = 0; f < frames; f++) {
      cancelled(signal);
      const t = f / fps;
      const sources = new Map<string, FrameSource | null>();
      for (const track of p.tracks) {
        if (track.kind !== 'video') continue;
        const clip = activeClip(track, t);
        const media = clip && typeOf(clip) === 'media' ? mediaOf(p, clip) : undefined;
        if (!clip || !media) continue;
        if (media.kind === 'video') sources.set(clip.id, await frameOf(clip, media));
        else if (media.kind === 'image') {
          let bmp = images.get(media.id);
          if (!bmp) {
            bmp = await createImageBitmap(await (await fetch(media.url)).blob());
            images.set(media.id, bmp);
          }
          sources.set(clip.id, { image: bmp, width: bmp.width, height: bmp.height });
        }
      }
      ctx.setTransform(canvas.width / p.width, 0, 0, canvas.height / p.height, 0, 0);
      renderFrame(ctx, p, t, (clip) => sources.get(clip.id) ?? null);
      await onFrame(t, f, frames);
    }
  } finally {
    for (const it of iterators.values()) await it.return();
    images.forEach((b) => b.close());
  }
}

export async function exportProject(p: Project, opts: ExportOptions): Promise<{ path: string; size: number } | null> {
  const total = duration(p);
  if (total <= 0) return null;
  const width = even(opts.width);
  const height = even(opts.height);
  const fps = opts.fps;

  const token = await call<string>('exportBegin', { name: p.name, ext: 'mp4' });
  const inputs = new Inputs();
  let ok = false;
  try {
    const writable = new WritableStream<StreamTargetChunk>({
      write(chunk) {
        desk.send(CH.videoExportWrite, { token, position: chunk.position, data: chunk.data });
      },
    });
    const output = new Output({ format: new Mp4OutputFormat({ fastStart: false }), target: new StreamTarget(writable, { chunked: true, chunkSize: 4 * 1024 * 1024 }) });
    const canvas = new OffscreenCanvas(width, height);

    const hasSound = p.tracks.some((t) => !t.muted && t.clips.some((c) => typeOf(c) === 'media' && mediaOf(p, c)?.hasAudio));
    let bitrate: number | typeof QUALITY_HIGH = QUALITY_HIGH;
    if (opts.targetMB) {
      const bits = opts.targetMB * 8 * 1024 * 1024 * 0.95;
      bitrate = Math.max(150000, Math.floor(bits / total - (hasSound ? AUDIO_BITRATE : 0)));
    }
    const video = new CanvasSource(canvas, { codec: 'avc', bitrate, keyFrameInterval: 2 });
    output.addVideoTrack(video, { frameRate: fps });
    const audio = hasSound ? new AudioBufferSource({ codec: 'aac', bitrate: AUDIO_BITRATE }) : null;
    if (audio) output.addAudioTrack(audio);
    await output.start();

    if (audio) {
      for (let from = 0; from < total; from += MIX_SECONDS) {
        cancelled(opts.signal);
        await audio.add(await mixPiece(p, from, Math.min(total, from + MIX_SECONDS), inputs));
        opts.onProgress((0.1 * Math.min(total, from + MIX_SECONDS)) / total);
      }
    }
    await renderFrames(p, canvas, fps, inputs, opts.signal, async (t, f, frames) => {
      await video.add(t, 1 / fps);
      if (f % 10 === 0) opts.onProgress((audio ? 0.1 : 0) + ((audio ? 0.9 : 1) * f) / frames);
    });
    await output.finalize();
    ok = true;
  } finally {
    inputs.dispose();
  }
  return ok ? call('exportEnd', { token, ok: true }) : (await call('exportEnd', { token, ok: false }), null);
}

export async function exportGif(p: Project, opts: ExportOptions): Promise<{ path: string; size: number } | null> {
  if (duration(p) <= 0) return null;
  const width = Math.round(opts.width);
  const height = Math.round(opts.height);
  const canvas = new OffscreenCanvas(width, height);
  const read = canvas.getContext('2d', { willReadFrequently: true })!;
  const gif = GIFEncoder();
  const inputs = new Inputs();
  const delay = Math.round(1000 / opts.fps);
  try {
    await renderFrames(p, canvas, opts.fps, inputs, opts.signal, async (_t, f, frames) => {
      const { data } = read.getImageData(0, 0, width, height);
      const palette = quantize(data, 256);
      gif.writeFrame(applyPalette(data, palette), width, height, f === 0 ? { palette, delay, repeat: 0 } : { palette, delay });
      if (f % 5 === 0) {
        opts.onProgress(f / frames);
        await new Promise((r) => setTimeout(r, 0));
      }
    });
  } finally {
    inputs.dispose();
  }
  gif.finish();
  const bytes = gif.bytes();
  const token = await call<string>('exportBegin', { name: p.name, ext: 'gif' });
  const piece = 4 * 1024 * 1024;
  for (let at = 0; at < bytes.length; at += piece) {
    desk.send(CH.videoExportWrite, { token, position: at, data: bytes.slice(at, at + piece) });
  }
  return call('exportEnd', { token, ok: true });
}

async function mixPiece(p: Project, from: number, to: number, inputs: Inputs): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.round((to - from) * RATE)), RATE);
  for (const track of p.tracks) {
    if (track.muted) continue;
    for (const clip of track.clips) {
      if (typeOf(clip) !== 'media') continue;
      const media = mediaOf(p, clip);
      const start = Math.max(from, clip.start);
      const end = Math.min(to, clipEnd(clip));
      if (!media?.hasAudio || end <= start) continue;
      const [atrack] = await inputs.of(media).getAudioTracks();
      if (!atrack) continue;
      const srcFrom = clip.in + (start - clip.start) * clip.speed;
      const srcTo = clip.in + (end - clip.start) * clip.speed;
      const gain = ctx.createGain();
      gain.gain.setValueAtTime(volumeAt(clip, start - clip.start), start - from);
      for (let tt = start + 0.02; tt < end; tt += 0.02) gain.gain.linearRampToValueAtTime(volumeAt(clip, tt - clip.start), tt - from);
      gain.connect(ctx.destination);
      for await (const { buffer, timestamp } of new AudioBufferSink(atrack).buffers(Math.max(0, srcFrom - 0.2), srcTo)) {
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        node.playbackRate.value = clip.speed;
        node.connect(gain);
        const skip = Math.max(0, srcFrom - timestamp);
        if (skip >= buffer.duration) continue;
        const when = Math.max(0, start - from + (timestamp + skip - srcFrom) / clip.speed);
        node.start(when, skip);
        node.stop(end - from);
      }
    }
  }
  return ctx.startRendering();
}
