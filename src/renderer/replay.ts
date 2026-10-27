import { BufferTarget, EncodedAudioPacketSource, EncodedPacket, EncodedVideoPacketSource, Mp4OutputFormat, Output } from 'mediabunny';
import { CH } from '../shared/channels';
import type { ReplayInit, ReplaySaved, ReplaySaveRequest } from '../shared/types';
import { desk } from './common';

declare const MediaStreamTrackProcessor: new <T>(init: { track: MediaStreamTrack }) => { readable: ReadableStream<T> };

interface Packet {
  data: Uint8Array;
  key: boolean;
  ts: number;
  dur: number;
}

interface Track {
  packets: Packet[];
  config: VideoDecoderConfig | AudioDecoderConfig | null;
  video: boolean;
}

interface Screen {
  track: Track;
  thumb: VideoFrame | null;
}

const now = () => performance.now() * 1000;
let init: ReplayInit;
let keep = 30e6;
const screens: Screen[] = [];
const sound: Track & { codec: 'aac' | 'opus' } = { packets: [], config: null, video: false, codec: 'aac' };
const stops: Array<() => void> = [];

function fail(err: unknown): void {
  stops.forEach((stop) => stop());
  desk.send(CH.replayFailed, err instanceof Error ? `${err.name}: ${err.message}` : String(err));
}

function push(track: Track, p: Packet): void {
  track.packets.push(p);
  const cutoff = now() - keep - 3e6;
  const list = track.packets;
  if (!list.length || list[0].ts >= cutoff - 1e6) return;
  let from = 0;
  if (track.video) {
    for (let i = 0; i < list.length && list[i].ts <= cutoff; i++) if (list[i].key) from = i;
  } else {
    while (from < list.length && list[from].ts < cutoff) from++;
  }
  if (from > 0) list.splice(0, from);
}

async function videoConfig(width: number, height: number, fps: number): Promise<VideoEncoderConfig> {
  const bitrate = Math.round(Math.min(16e6, Math.max(3e6, width * height * fps * 0.1)));
  for (const codec of ['avc1.640033', 'avc1.4d0033', 'avc1.42e033']) {
    for (const hardwareAcceleration of ['prefer-hardware', 'no-preference'] as const) {
      const config: VideoEncoderConfig = { codec, width, height, bitrate, framerate: fps, hardwareAcceleration, avc: { format: 'avc' } };
      if ((await VideoEncoder.isConfigSupported(config)).supported) return config;
    }
  }
  throw new Error(`No H.264 encoder for ${width}x${height}`);
}

async function startScreen(index: number, src: ReplayInit['screens'][number]): Promise<void> {
  const fps = init.fps;
  const constraints = {
    audio: false,
    video: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: src.sourceId, maxWidth: src.width, maxHeight: src.height, maxFrameRate: fps } },
  } as unknown as MediaStreamConstraints;
  const stream = await navigator.mediaDevices.getUserMedia(constraints);
  stops.push(() => stream.getTracks().forEach((t) => t.stop()));
  const screen: Screen = { track: { packets: [], config: null, video: true }, thumb: null };
  screens[index] = screen;

  let offset = 0;
  let lastKey = -Infinity;
  let lastThumb = -Infinity;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig) screen.track.config = meta.decoderConfig;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      push(screen.track, { data, key: chunk.type === 'key', ts: chunk.timestamp + offset, dur: chunk.duration ?? 1e6 / fps });
    },
    error: fail,
  });
  stops.push(() => encoder.state !== 'closed' && encoder.close());

  const reader = new MediaStreamTrackProcessor<VideoFrame>({ track: stream.getVideoTracks()[0] }).readable.getReader();
  stops.push(() => void reader.cancel().catch(() => {}));
  for (;;) {
    const { value: frame, done } = await reader.read();
    if (done || !frame) return;
    if (encoder.state === 'unconfigured') {
      offset = now() - frame.timestamp;
      encoder.configure(await videoConfig(frame.displayWidth & ~1, frame.displayHeight & ~1, fps));
    }
    if (encoder.state !== 'configured' || encoder.encodeQueueSize > 4) {
      frame.close();
      continue;
    }
    const keyFrame = frame.timestamp - lastKey >= 1e6;
    if (keyFrame) lastKey = frame.timestamp;
    encoder.encode(frame, { keyFrame });
    if (frame.timestamp - lastThumb >= 2e6) {
      lastThumb = frame.timestamp;
      screen.thumb?.close();
      screen.thumb = frame.clone();
    }
    frame.close();
  }
}

async function startSound(): Promise<void> {
  const ctx = new AudioContext({ sampleRate: 48000 });
  stops.push(() => void ctx.close());
  await ctx.audioWorklet.addModule('replay-worklet.js');
  const feed = new AudioWorkletNode(ctx, 'pcm-feed', { numberOfInputs: 0, outputChannelCount: [2] });
  desk.on<{ dev: number; pcm: Float32Array }>(CH.replayAudio, (piece) => {
    if (piece?.pcm instanceof Float32Array) feed.port.postMessage(piece, [piece.pcm.buffer]);
  });
  const mix = ctx.createDynamicsCompressor();
  mix.threshold.value = -3;
  mix.knee.value = 0;
  mix.ratio.value = 20;
  mix.attack.value = 0.003;
  mix.release.value = 0.25;
  feed.connect(mix);
  if (init.mic) {
    try {
      const mic = await navigator.mediaDevices.getUserMedia({
        audio: { deviceId: init.micId ? { exact: init.micId } : undefined, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
      });
      stops.push(() => mic.getTracks().forEach((t) => t.stop()));
      ctx.createMediaStreamSource(mic).connect(mix);
    } catch {
    }
  }
  const dest = ctx.createMediaStreamDestination();
  dest.channelCount = 2;
  mix.connect(dest);
  if (ctx.state !== 'running') await ctx.resume();

  let config: AudioEncoderConfig = { codec: 'mp4a.40.2', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 };
  if (!(await AudioEncoder.isConfigSupported(config)).supported) {
    config = { codec: 'opus', sampleRate: 48000, numberOfChannels: 2, bitrate: 160000 };
    sound.codec = 'opus';
  }
  let offset = 0;
  const encoder = new AudioEncoder({
    output: (chunk, meta) => {
      if (meta?.decoderConfig) sound.config = meta.decoderConfig;
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      push(sound, { data, key: true, ts: chunk.timestamp + offset, dur: chunk.duration ?? 0 });
    },
    error: fail,
  });
  encoder.configure(config);
  stops.push(() => encoder.state !== 'closed' && encoder.close());

  const reader = new MediaStreamTrackProcessor<AudioData>({ track: dest.stream.getAudioTracks()[0] }).readable.getReader();
  stops.push(() => void reader.cancel().catch(() => {}));
  let first = true;
  for (;;) {
    const { value: data, done } = await reader.read();
    if (done || !data) return;
    if (first) {
      offset = now() - data.timestamp;
      first = false;
    }
    encoder.encode(data);
    data.close();
  }
}

function thumbOf(frame: VideoFrame | null): string | undefined {
  if (!frame) return undefined;
  const w = 480;
  const h = Math.max(1, Math.round((frame.displayHeight / frame.displayWidth) * w));
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  canvas.getContext('2d')?.drawImage(frame, 0, 0, w, h);
  return canvas.toDataURL('image/png');
}

async function save(req: ReplaySaveRequest): Promise<ReplaySaved> {
  const end = now();
  const start = end - keep;
  const screen = req.screen >= 0 ? screens[req.screen] ?? screens.find(Boolean) : undefined;
  let base = start;
  let video: Packet[] = [];
  if (screen) {
    const list = screen.track.packets;
    let from = -1;
    for (let i = 0; i < list.length && list[i].ts <= start; i++) if (list[i].key) from = i;
    if (from < 0) from = list.findIndex((p) => p.key);
    if (from < 0 || !screen.track.config) return { id: req.id, error: 'No picture yet' };
    video = list.slice(from).filter((p) => p.ts <= end);
    base = video[0].ts;
  }
  const audio = sound.config ? sound.packets.filter((p) => p.ts >= base && p.ts <= end) : [];
  if (!video.length && !audio.length) return { id: req.id, error: 'Nothing recorded yet' };

  const output = new Output({ format: new Mp4OutputFormat({ fastStart: 'in-memory' }), target: new BufferTarget() });
  const videoSource = video.length ? new EncodedVideoPacketSource('avc') : null;
  const audioSource = audio.length ? new EncodedAudioPacketSource(sound.codec) : null;
  if (videoSource) output.addVideoTrack(videoSource, { frameRate: init.fps });
  if (audioSource) output.addAudioTrack(audioSource);
  await output.start();
  if (videoSource) {
    for (let i = 0; i < video.length; i++) {
      const p = video[i];
      const dur = i + 1 < video.length ? video[i + 1].ts - p.ts : 1e6 / init.fps;
      const packet = new EncodedPacket(p.data, p.key ? 'key' : 'delta', (p.ts - base) / 1e6, Math.max(1, dur) / 1e6);
      await videoSource.add(packet, i === 0 ? { decoderConfig: screen!.track.config as VideoDecoderConfig } : undefined);
    }
  }
  if (audioSource) {
    for (let i = 0; i < audio.length; i++) {
      const p = audio[i];
      const packet = new EncodedPacket(p.data, 'key', (p.ts - base) / 1e6, p.dur / 1e6);
      await audioSource.add(packet, i === 0 ? { decoderConfig: sound.config as AudioDecoderConfig } : undefined);
    }
  }
  await output.finalize();
  const buffer = output.target.buffer;
  if (!buffer) return { id: req.id, error: 'Empty clip' };
  return { id: req.id, bytes: new Uint8Array(buffer), ext: videoSource ? 'mp4' : 'm4a', thumb: thumbOf(screen?.thumb ?? null) };
}

async function main(): Promise<void> {
  init = await desk.invoke<ReplayInit>(CH.replayInit);
  keep = init.seconds * 1e6;
  desk.on<ReplaySaveRequest>(CH.replaySave, (req) => {
    save(req)
      .then((saved) => desk.send(CH.replaySaved, saved))
      .catch((err: unknown) => desk.send(CH.replaySaved, { id: req.id, error: err instanceof Error ? err.message : String(err) }));
  });
  if (init.mode === 'screen') init.screens.forEach((src, i) => void startScreen(i, src).catch((err) => console.error('Screen', i, err)));
  await startSound();
}

main().catch(fail);
