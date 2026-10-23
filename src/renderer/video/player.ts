import type { Clip, MediaItem, Project } from '../../shared/types';
import { activeClip, clipEnd, duration, mediaOf, typeOf, volumeAt } from './project';
import { renderFrame, type FrameSource } from './render';

interface Element {
  el: HTMLVideoElement | HTMLAudioElement;
  gain: GainNode;
  mediaId: string;
  silent: boolean;
}

export class Player {
  private readonly elements = new Map<string, Element>();
  private readonly images = new Map<string, HTMLImageElement>();
  private audio: AudioContext | null = null;
  private project: Project | null = null;
  private wall = 0;
  private from = 0;
  private frame = 0;
  playing = false;
  time = 0;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly onTime: (t: number) => void,
    private readonly onState: (playing: boolean) => void,
  ) {}

  private get ctx(): AudioContext {
    this.audio ??= new AudioContext();
    return this.audio;
  }

  setProject(p: Project): void {
    this.project = p;
    const clips = new Set<string>();
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        if (typeOf(clip) !== 'media') continue;
        const media = mediaOf(p, clip);
        if (!media) continue;
        clips.add(clip.id);
        if (media.kind === 'image') {
          if (!this.images.has(media.id)) {
            const img = new Image();
            img.src = media.url;
            img.onload = () => this.draw();
            this.images.set(media.id, img);
          }
          continue;
        }
        let e = this.elements.get(clip.id);
        if (e && e.mediaId !== media.id) {
          this.drop(clip.id);
          e = undefined;
        }
        if (!e) e = this.create(clip, media);
        e.silent = track.muted || (track.kind === 'video' && !media.hasAudio);
        this.setGain(e, clip, this.time);
      }
    }
    for (const id of [...this.elements.keys()]) if (!clips.has(id)) this.drop(id);
    this.canvas.width = p.width;
    this.canvas.height = p.height;
    if (!this.playing) this.seek(Math.min(this.time, duration(p)));
  }

  private create(clip: Clip, media: MediaItem): Element {
    const el = media.kind === 'video' ? document.createElement('video') : document.createElement('audio');
    el.crossOrigin = 'anonymous';
    el.preload = 'auto';
    el.src = media.url;
    el.preservesPitch = false;
    if (el instanceof HTMLVideoElement) el.playsInline = true;
    el.addEventListener('seeked', () => {
      if (!this.playing) this.draw();
    });
    el.addEventListener('loadeddata', () => {
      if (!this.playing) this.draw();
    });
    const gain = this.ctx.createGain();
    this.ctx.createMediaElementSource(el).connect(gain).connect(this.ctx.destination);
    const e: Element = { el, gain, mediaId: media.id, silent: false };
    this.elements.set(clip.id, e);
    return e;
  }

  private drop(clipId: string): void {
    const e = this.elements.get(clipId);
    if (!e) return;
    e.el.pause();
    e.el.removeAttribute('src');
    e.el.load();
    e.gain.disconnect();
    this.elements.delete(clipId);
  }

  private setGain(e: Element, clip: Clip, t: number): void {
    const v = e.silent ? 0 : volumeAt(clip, Math.max(0, t - clip.start));
    if (Math.abs(e.gain.gain.value - v) > 0.001) e.gain.gain.value = v;
  }

  private sourceTime(clip: Clip, t: number): number {
    return clip.in + (t - clip.start) * clip.speed;
  }

  seek(t: number): void {
    const p = this.project;
    if (!p) return;
    this.time = Math.max(0, Math.min(t, duration(p)));
    if (this.playing) {
      this.from = this.time;
      this.wall = performance.now();
    }
    for (const track of p.tracks) {
      for (const clip of track.clips) {
        const e = this.elements.get(clip.id);
        if (!e) continue;
        const inside = this.time >= clip.start && this.time < clipEnd(clip);
        const target = inside ? this.sourceTime(clip, this.time) : clip.in;
        if (Math.abs(e.el.currentTime - target) > 0.001) e.el.currentTime = target;
        if (!this.playing) e.el.pause();
      }
    }
    this.onTime(this.time);
    this.draw();
  }

  play(): void {
    const p = this.project;
    if (!p || this.playing) return;
    if (this.time >= duration(p) - 0.01) this.time = 0;
    void this.ctx.resume();
    this.playing = true;
    this.from = this.time;
    this.wall = performance.now();
    this.onState(true);
    this.tick();
  }

  pause(): void {
    if (!this.playing) return;
    this.playing = false;
    cancelAnimationFrame(this.frame);
    for (const e of this.elements.values()) e.el.pause();
    this.onState(false);
    this.seek(this.time);
  }

  toggle(): void {
    if (this.playing) this.pause();
    else this.play();
  }

  private tick = (): void => {
    const p = this.project;
    if (!p || !this.playing) return;
    const end = duration(p);
    this.time = this.from + (performance.now() - this.wall) / 1000;
    if (this.time >= end) {
      this.time = end;
      this.pause();
      return;
    }
    for (const track of p.tracks) {
      const active = activeClip(track, this.time);
      for (const clip of track.clips) {
        const e = this.elements.get(clip.id);
        if (!e) continue;
        if (clip !== active) {
          if (!e.el.paused) e.el.pause();
          continue;
        }
        const target = this.sourceTime(clip, this.time);
        this.setGain(e, clip, this.time);
        if (e.el.playbackRate !== clip.speed) e.el.playbackRate = clip.speed;
        if (e.el.paused) {
          e.el.currentTime = target;
          void e.el.play().catch(() => {});
        } else if (Math.abs(e.el.currentTime - target) > 0.25) {
          e.el.currentTime = target;
        }
      }
    }
    this.draw();
    this.onTime(this.time);
    this.frame = requestAnimationFrame(this.tick);
  };

  draw(): void {
    const p = this.project;
    const ctx = this.canvas.getContext('2d');
    if (!p || !ctx) return;
    renderFrame(ctx, p, this.time, (clip, media) => this.source(clip, media));
  }

  private source(clip: Clip, media: MediaItem): FrameSource | null {
    if (media.kind === 'image') {
      const img = this.images.get(media.id);
      return img?.complete && img.naturalWidth ? { image: img, width: img.naturalWidth, height: img.naturalHeight } : null;
    }
    const e = this.elements.get(clip.id);
    if (!(e?.el instanceof HTMLVideoElement) || e.el.readyState < 2) return null;
    return { image: e.el, width: e.el.videoWidth, height: e.el.videoHeight };
  }

  dispose(): void {
    this.pause();
    for (const id of [...this.elements.keys()]) this.drop(id);
    void this.audio?.close();
  }
}
