import { ALL_FORMATS, Input, UrlSource } from 'mediabunny';
import type {
  AnimProp,
  Clip,
  ClipFilters,
  ClipType,
  Ease,
  EffectStyle,
  Keyframe,
  MediaItem,
  Project,
  SessionMedia,
  ShapeStyle,
  Track,
  ZoomSegment,
} from '../../shared/types';

export const IMAGE_SECONDS = 5;
export const MIN_CLIP = 0.1;

export function uid(prefix: string): string {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clipLength(c: Clip): number {
  return (c.out - c.in) / c.speed;
}

export function clipEnd(c: Clip): number {
  return c.start + clipLength(c);
}

export function duration(p: Project): number {
  let end = 0;
  for (const t of p.tracks) for (const c of t.clips) end = Math.max(end, clipEnd(c));
  return end;
}

export function activeClip(track: Track, t: number): Clip | null {
  let found: Clip | null = null;
  for (const c of track.clips) if (t >= c.start && t < clipEnd(c)) found = c;
  return found;
}

export function mediaOf(p: Project, c: Clip): MediaItem | undefined {
  return p.media.find((m) => m.id === c.mediaId);
}

export function even(n: number): number {
  return Math.max(2, Math.round(n / 2) * 2);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

export function newProject(name: string): Project {
  const now = new Date().toISOString();
  return {
    version: 1,
    id: `p-${stamp()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    created: now,
    updated: now,
    width: 1920,
    height: 1080,
    fps: 30,
    background: '#000000',
    media: [],
    tracks: [newTrack('video'), newTrack('audio')],
  };
}

export function newTrack(kind: Track['kind']): Track {
  return { id: uid('t'), kind, clips: [], muted: false };
}

export function newClip(m: MediaItem, start: number): Clip {
  return {
    id: uid('c'),
    mediaId: m.id,
    start,
    in: 0,
    out: m.kind === 'image' ? IMAGE_SECONDS : m.duration,
    speed: 1,
    volume: 1,
    fit: 'contain',
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
  };
}

export function trackFor(p: Project, kind: Track['kind']): Track {
  let t = p.tracks.find((x) => x.kind === kind);
  if (!t) {
    t = newTrack(kind);
    p.tracks.push(t);
  }
  return t;
}

export function trackEnd(t: Track): number {
  return t.clips.reduce((end, c) => Math.max(end, clipEnd(c)), 0);
}

const IMAGE_EXT = /\.(png|jpe?g|webp|gif)$/i;

export async function probe(file: { path: string; url: string; name: string }, extra: Partial<MediaItem> = {}): Promise<MediaItem> {
  const base = { id: uid('m'), path: file.path, url: file.url, name: file.name, crop: null, session: null, ...extra };
  if (IMAGE_EXT.test(file.path)) {
    const img = new Image();
    img.src = file.url;
    await img.decode();
    return { ...base, kind: 'image', duration: 0, width: img.naturalWidth, height: img.naturalHeight, hasAudio: false };
  }
  const input = new Input({ source: new UrlSource(file.url), formats: ALL_FORMATS });
  try {
    const [video] = await input.getVideoTracks();
    const [audio] = await input.getAudioTracks();
    if (!video && !audio) throw new Error('No track');
    const length = await input.computeDuration();
    return {
      ...base,
      kind: video ? 'video' : 'audio',
      duration: length,
      width: video?.displayWidth ?? 0,
      height: video?.displayHeight ?? 0,
      hasAudio: !!audio,
    };
  } finally {
    input.dispose();
  }
}

export async function projectFromRecording(rec: SessionMedia, name: string, autoZoom = false): Promise<Project> {
  const p = newProject(name);
  const s = rec.session;
  p.fps = s.fps === 60 ? 60 : 30;
  const screen = rec.files.screen;
  if (!screen) return p;
  const media = await probe({ ...screen, name: 'screen' }, { crop: s.area, session: rec.dir, clicks: rec.cursor?.clicks });
  p.media.push(media);
  const area = s.area ?? { x: 0, y: 0, w: 1, h: 1 };
  p.width = even(media.width * area.w);
  p.height = even(media.height * area.h);
  p.tracks = [newTrack('video')];
  const main = newClip(media, 0);
  if (media.clicks?.length) {
    main.clicks = true;
    if (autoZoom) main.zooms = autoZooms(main, media);
  }
  p.tracks[0].clips.push(main);
  if (rec.files.webcam) {
    const cam = await probe({ ...rec.files.webcam, name: 'webcam' }, { session: rec.dir }).catch(() => null);
    if (cam) {
      p.media.push(cam);
      const track = newTrack('video');
      const clip = newClip(cam, s.offsets.webcam ?? 0);
      Object.assign(clip, { scale: 0.3, x: 0.36, y: 0.3, mask: 'circle' });
      track.clips.push(clip);
      p.tracks.push(track);
    }
  }
  const audio = newTrack('audio');
  if (rec.files.mic) {
    const mic = await probe({ ...rec.files.mic, name: 'mic' }, { session: rec.dir }).catch(() => null);
    if (mic) {
      p.media.push(mic);
      audio.clips.push(newClip(mic, s.offsets.mic ?? 0));
    }
  }
  p.tracks.push(audio);
  return p;
}

export class History {
  private stack: string[] = [];
  private at = -1;

  reset(p: Project): void {
    this.stack = [JSON.stringify(p)];
    this.at = 0;
  }

  push(p: Project): void {
    const json = JSON.stringify(p);
    if (json === this.stack[this.at]) return;
    this.stack = this.stack.slice(0, this.at + 1);
    this.stack.push(json);
    if (this.stack.length > 300) this.stack.shift();
    this.at = this.stack.length - 1;
  }

  undo(): Project | null {
    if (this.at <= 0) return null;
    this.at -= 1;
    return JSON.parse(this.stack[this.at]) as Project;
  }

  redo(): Project | null {
    if (this.at >= this.stack.length - 1) return null;
    this.at += 1;
    return JSON.parse(this.stack[this.at]) as Project;
  }

  get canUndo(): boolean {
    return this.at > 0;
  }

  get canRedo(): boolean {
    return this.at < this.stack.length - 1;
  }
}

export function typeOf(c: Clip): ClipType {
  return c.type ?? 'media';
}

export const DEFAULT_FILTERS: ClipFilters = { brightness: 1, contrast: 1, saturation: 1, grayscale: 0 };

export function baseValue(c: Clip, prop: AnimProp): number {
  switch (prop) {
    case 'x':
    case 'y':
    case 'scale':
    case 'opacity':
    case 'volume':
      return c[prop];
    case 'rotation':
      return c.rotation ?? 0;
    default:
      return (c.filters ?? DEFAULT_FILTERS)[prop];
  }
}

function setBase(c: Clip, prop: AnimProp, v: number): void {
  switch (prop) {
    case 'x':
    case 'y':
    case 'scale':
    case 'opacity':
    case 'volume':
      c[prop] = v;
      return;
    case 'rotation':
      c.rotation = v;
      return;
    default:
      c.filters = { ...(c.filters ?? DEFAULT_FILTERS), [prop]: v };
  }
}

const EASES: Record<Ease, (k: number) => number> = {
  linear: (k) => k,
  smooth: (k) => k * k * (3 - 2 * k),
  in: (k) => k * k,
  out: (k) => 1 - (1 - k) * (1 - k),
  hold: () => 0,
};

export function ease(kind: Ease, k: number): number {
  return EASES[kind](Math.max(0, Math.min(1, k)));
}

export function sample(c: Clip, prop: AnimProp, tRel: number): number {
  const keys = c.keyframes?.[prop];
  if (!keys?.length) return baseValue(c, prop);
  if (tRel <= keys[0].t) return keys[0].v;
  for (let i = 0; i < keys.length - 1; i++) {
    const a = keys[i];
    const b = keys[i + 1];
    if (tRel < b.t) return a.v + (b.v - a.v) * ease(a.ease, (tRel - a.t) / (b.t - a.t));
  }
  return keys[keys.length - 1].v;
}

const NEAR = 1 / 120;

export function keyframeAt(c: Clip, prop: AnimProp, tRel: number): Keyframe | undefined {
  return c.keyframes?.[prop]?.find((k) => Math.abs(k.t - tRel) < NEAR);
}

export function setValue(c: Clip, prop: AnimProp, v: number, tRel: number): void {
  const keys = c.keyframes?.[prop];
  if (!keys?.length) return setBase(c, prop, v);
  const k = keyframeAt(c, prop, tRel);
  if (k) k.v = v;
  else {
    keys.push({ t: tRel, v, ease: 'smooth' });
    keys.sort((a, b) => a.t - b.t);
  }
}

export function toggleKeyframe(c: Clip, prop: AnimProp, tRel: number): void {
  c.keyframes ??= {};
  const keys = (c.keyframes[prop] ??= []);
  const k = keyframeAt(c, prop, tRel);
  if (k) {
    keys.splice(keys.indexOf(k), 1);
    if (!keys.length) delete c.keyframes[prop];
    return;
  }
  keys.push({ t: Math.max(0, tRel), v: sample(c, prop, tRel), ease: 'smooth' });
  keys.sort((a, b) => a.t - b.t);
}

export function zoomAt(c: Clip, tRel: number): { scale: number; x: number; y: number } {
  for (const z of c.zooms ?? []) {
    if (tRel < z.t || tRel > z.t + z.d) continue;
    const ramp = Math.min(0.6, z.d / 3);
    const k = ease('smooth', Math.min((tRel - z.t) / ramp, (z.t + z.d - tRel) / ramp, 1));
    return { scale: 1 + (z.scale - 1) * k, x: 0.5 + (z.x - 0.5) * k, y: 0.5 + (z.y - 0.5) * k };
  }
  return { scale: 1, x: 0.5, y: 0.5 };
}

export function autoZooms(c: Clip, media: MediaItem, scale = 1.8): ZoomSegment[] {
  const crop = media.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  const out: ZoomSegment[] = [];
  const clicks = media.clicks ?? [];
  for (let i = 0; i + 3 < clicks.length; i += 4) {
    const [ts, cx, cy, button] = clicks.slice(i, i + 4);
    if (button !== 0 || ts < c.in || ts > c.out) continue;
    const x = (cx - crop.x) / crop.w;
    const y = (cy - crop.y) / crop.h;
    if (x < 0 || x > 1 || y < 0 || y > 1) continue;
    const t = (ts - c.in) / c.speed;
    const start = Math.max(0, t - 0.5);
    const end = t + 1.8;
    const last = out[out.length - 1];
    const near = last && Math.hypot(last.x - x, last.y - y) < 0.2;
    if (last && near && start <= last.t + last.d + 0.6) {
      last.d = end - last.t;
      last.x = (last.x + x) / 2;
      last.y = (last.y + y) / 2;
    } else {
      if (last && last.t + last.d > start) last.d = Math.max(0.6, start - last.t);
      out.push({ t: Math.max(start, last ? last.t + last.d : 0), d: end - start, x, y, scale });
    }
  }
  const len = clipLength(c);
  return out.filter((z) => z.t < len).map((z) => ({ ...z, d: Math.min(z.d, len - z.t) }));
}

function graphicClip(type: ClipType, start: number, w: number, h: number): Clip {
  return {
    id: uid('c'),
    mediaId: '',
    start,
    in: 0,
    out: 3,
    speed: 1,
    volume: 1,
    fit: 'contain',
    x: 0,
    y: 0,
    scale: 1,
    opacity: 1,
    type,
    w,
    h,
  };
}

export function newTextClip(start: number, content: string): Clip {
  const c = graphicClip('text', start, 0.6, 0.14);
  c.y = 0.3;
  c.text = { content, size: 0.08, color: '#ffffff', background: null, bold: true, align: 'center' };
  c.enter = { kind: 'fade', duration: 0.3 };
  c.exit = { kind: 'fade', duration: 0.3 };
  return c;
}

export function newShapeClip(start: number, kind: ShapeStyle['kind']): Clip {
  const c = graphicClip('shape', start, kind === 'arrow' ? 0.25 : 0.3, kind === 'arrow' ? 0.12 : 0.2);
  c.shape = { kind, color: '#ff3b5c', width: 0.008, fill: false };
  return c;
}

export function newEffectClip(start: number, kind: EffectStyle['kind']): Clip {
  const c = graphicClip('effect', start, 0.3, 0.15);
  c.effect = { kind, strength: kind === 'blur' ? 16 : 18 };
  return c;
}

export function volumeAt(c: Clip, tRel: number): number {
  let v = sample(c, 'volume', tRel);
  const len = clipLength(c);
  if (c.fadeIn && tRel < c.fadeIn) v *= Math.max(0, tRel / c.fadeIn);
  if (c.fadeOut && tRel > len - c.fadeOut) v *= Math.max(0, (len - tRel) / c.fadeOut);
  return v;
}
