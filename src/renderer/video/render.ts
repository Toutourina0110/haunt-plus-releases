import type { Clip, ClipTransition, MediaItem, Project } from '../../shared/types';
import { activeClip, clipLength, DEFAULT_FILTERS, ease, mediaOf, sample, typeOf, zoomAt } from './project';

export interface FrameSource {
  image: CanvasImageSource;
  width: number;
  height: number;
}

export type SourceOf = (clip: Clip, media: MediaItem) => FrameSource | null;
type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

let family = 'sans-serif';
export function setTextFamily(f: string): void {
  family = f || 'sans-serif';
}

export function renderFrame(ctx: Ctx, p: Project, t: number, source: SourceOf): void {
  ctx.save();
  ctx.globalAlpha = 1;
  ctx.filter = 'none';
  if (p.background2) {
    const g = ctx.createLinearGradient(0, 0, p.width, p.height);
    g.addColorStop(0, p.background);
    g.addColorStop(1, p.background2);
    ctx.fillStyle = g;
  } else ctx.fillStyle = p.background;
  ctx.fillRect(0, 0, p.width, p.height);
  ctx.imageSmoothingQuality = 'high';
  for (const track of p.tracks) {
    if (track.kind !== 'video') continue;
    const clip = activeClip(track, t);
    if (!clip) continue;
    const tRel = t - clip.start;
    const type = typeOf(clip);
    if (type === 'media') {
      const media = mediaOf(p, clip);
      if (!media || media.kind === 'audio') continue;
      const src = source(clip, media);
      if (src) drawMedia(ctx, p, clip, media, src, tRel);
    } else if (type === 'effect') drawEffect(ctx, p, clip, tRel);
    else drawGraphic(ctx, p, clip, tRel);
  }
  ctx.restore();
}

interface Place {
  cx: number;
  cy: number;
  scale: number;
  rotation: number;
  alpha: number;
}

function transition(tr: ClipTransition | undefined, k: number, p: Project, place: Place): void {
  if (!tr || tr.kind === 'none' || k >= 1) return;
  const e = ease('smooth', k);
  switch (tr.kind) {
    case 'fade':
      place.alpha *= e;
      break;
    case 'zoom':
      place.alpha *= e;
      place.scale *= 0.6 + 0.4 * e;
      break;
    case 'slide-left':
      place.cx += (1 - e) * p.width;
      break;
    case 'slide-right':
      place.cx -= (1 - e) * p.width;
      break;
    case 'slide-up':
      place.cy += (1 - e) * p.height;
      break;
    case 'slide-down':
      place.cy -= (1 - e) * p.height;
      break;
  }
}

function placeOf(p: Project, clip: Clip, tRel: number): Place {
  const place: Place = {
    cx: p.width / 2 + sample(clip, 'x', tRel) * p.width,
    cy: p.height / 2 + sample(clip, 'y', tRel) * p.height,
    scale: sample(clip, 'scale', tRel),
    rotation: (sample(clip, 'rotation', tRel) * Math.PI) / 180,
    alpha: Math.max(0, Math.min(1, sample(clip, 'opacity', tRel))),
  };
  const len = clipLength(clip);
  if (clip.enter?.duration) transition(clip.enter, tRel / clip.enter.duration, p, place);
  if (clip.exit?.duration) {
    const mirror: Record<string, ClipTransition['kind']> = { 'slide-left': 'slide-right', 'slide-right': 'slide-left', 'slide-up': 'slide-down', 'slide-down': 'slide-up' };
    transition({ ...clip.exit, kind: mirror[clip.exit.kind] ?? clip.exit.kind }, (len - tRel) / clip.exit.duration, p, place);
  }
  return place;
}

function filterOf(clip: Clip, tRel: number): string {
  const f = clip.filters ?? DEFAULT_FILTERS;
  if (!clip.keyframes && f.brightness === 1 && f.contrast === 1 && f.saturation === 1 && f.grayscale === 0) return 'none';
  const b = sample(clip, 'brightness', tRel);
  const c = sample(clip, 'contrast', tRel);
  const s = sample(clip, 'saturation', tRel);
  const g = sample(clip, 'grayscale', tRel);
  if (b === 1 && c === 1 && s === 1 && g === 0) return 'none';
  return `brightness(${b}) contrast(${c}) saturate(${s}) grayscale(${g})`;
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.max(0, Math.min(r, w / 2, h / 2)));
}

function drawMedia(ctx: Ctx, p: Project, clip: Clip, media: MediaItem, src: FrameSource, tRel: number): void {
  const crop = media.crop ?? { x: 0, y: 0, w: 1, h: 1 };
  let sx = crop.x * src.width;
  let sy = crop.y * src.height;
  let sw = Math.max(1, crop.w * src.width);
  let sh = Math.max(1, crop.h * src.height);

  const z = zoomAt(clip, tRel);
  const zw = sw / z.scale;
  const zh = sh / z.scale;
  const zx = sx + Math.max(0, Math.min(sw - zw, z.x * sw - zw / 2));
  const zy = sy + Math.max(0, Math.min(sh - zh, z.y * sh - zh / 2));

  let kx: number;
  let ky: number;
  if (clip.fit === 'fill') {
    kx = p.width / sw;
    ky = p.height / sh;
  } else {
    const k = clip.fit === 'cover' ? Math.max(p.width / sw, p.height / sh) : Math.min(p.width / sw, p.height / sh);
    kx = k;
    ky = k;
  }
  let w = sw * kx;
  let h = sh * ky;
  const frame = clip.frame;
  if (frame && frame.padding > 0) {
    w *= 1 - 2 * frame.padding;
    h *= 1 - 2 * frame.padding;
  }
  let [dsx, dsy, dsw, dsh] = [zx, zy, zw, zh];
  if (clip.mask === 'circle') {
    const side = Math.min(w, h);
    const ratio = zw / zh;
    if (ratio > 1) {
      dsx += (zw - zh) / 2;
      dsw = zh;
    } else {
      dsy += (zh - zw) / 2;
      dsh = zw;
    }
    w = side;
    h = side;
  }

  const place = placeOf(p, clip, tRel);
  w *= place.scale;
  h *= place.scale;
  if (w < 1 || h < 1 || place.alpha <= 0) return;

  ctx.save();
  ctx.translate(place.cx, place.cy);
  ctx.rotate(place.rotation);
  ctx.globalAlpha = place.alpha;
  const radius = clip.mask === 'circle' ? Math.min(w, h) / 2 : clip.mask === 'rounded' ? Math.min(w, h) * 0.08 : frame ? frame.radius * Math.min(w, h) : 0;
  if (frame?.shadow) {
    ctx.save();
    ctx.shadowColor = 'rgba(0, 0, 0, 0.45)';
    ctx.shadowBlur = Math.min(w, h) * 0.06;
    ctx.shadowOffsetY = Math.min(w, h) * 0.02;
    ctx.fillStyle = '#000';
    roundRect(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.fill();
    ctx.restore();
  }
  if (radius > 0) {
    roundRect(ctx, -w / 2, -h / 2, w, h, radius);
    ctx.clip();
  }
  ctx.filter = filterOf(clip, tRel);
  ctx.drawImage(src.image, dsx, dsy, dsw, dsh, -w / 2, -h / 2, w, h);
  ctx.filter = 'none';
  if (clip.clicks && media.clicks?.length) {
    drawClicks(ctx, clip, media, tRel, { x: dsx, y: dsy, w: dsw, h: dsh }, src, w, h);
  }
  ctx.restore();
}

function drawClicks(
  ctx: Ctx,
  clip: Clip,
  media: MediaItem,
  tRel: number,
  shown: { x: number; y: number; w: number; h: number },
  src: FrameSource,
  w: number,
  h: number,
): void {
  const now = clip.in + tRel * clip.speed;
  const clicks = media.clicks!;
  const size = Math.min(w, h);
  for (let i = 0; i + 3 < clicks.length; i += 4) {
    const age = (now - clicks[i]) / clip.speed;
    if (age < 0 || age > 0.6) continue;
    const px = clicks[i + 1] * src.width;
    const py = clicks[i + 2] * src.height;
    const x = ((px - shown.x) / shown.w - 0.5) * w;
    const y = ((py - shown.y) / shown.h - 0.5) * h;
    const k = age / 0.6;
    ctx.save();
    ctx.globalAlpha *= 1 - k;
    ctx.strokeStyle = clicks[i + 3] === 0 ? '#8079c9' : '#ff9f1c';
    ctx.lineWidth = size * 0.006;
    ctx.beginPath();
    ctx.arc(x, y, size * (0.012 + 0.03 * ease('out', k)), 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle;
    ctx.globalAlpha *= 0.35;
    ctx.fill();
    ctx.restore();
  }
}

function drawGraphic(ctx: Ctx, p: Project, clip: Clip, tRel: number): void {
  const place = placeOf(p, clip, tRel);
  const w = (clip.w ?? 0.3) * p.width * place.scale;
  const h = (clip.h ?? 0.15) * p.height * place.scale;
  if (place.alpha <= 0 || w < 1 || h < 1) return;
  ctx.save();
  ctx.translate(place.cx, place.cy);
  ctx.rotate(place.rotation);
  ctx.globalAlpha = place.alpha;
  ctx.filter = filterOf(clip, tRel);
  if (clip.text) drawText(ctx, p, clip, w, place.scale);
  else if (clip.shape) drawShape(ctx, p, clip, w, h, place.scale);
  ctx.restore();
}

function drawText(ctx: Ctx, p: Project, clip: Clip, w: number, scale: number): void {
  const t = clip.text!;
  const size = Math.max(4, t.size * p.height * scale);
  const lines = t.content.split('\n');
  ctx.font = `${t.bold ? 700 : 500} ${size}px ${family}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = t.align;
  const lineH = size * 1.2;
  if (t.background) {
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const bw = Math.min(w, textW + size * 0.8);
    const bh = lines.length * lineH + size * 0.4;
    const bx = t.align === 'left' ? -w / 2 : t.align === 'right' ? w / 2 - bw : -bw / 2;
    ctx.fillStyle = t.background;
    roundRect(ctx, bx, -bh / 2, bw, bh, size * 0.25);
    ctx.fill();
  }
  const x = t.align === 'left' ? -w / 2 + size * 0.4 : t.align === 'right' ? w / 2 - size * 0.4 : 0;
  ctx.fillStyle = t.color;
  if (!t.background) {
    ctx.shadowColor = 'rgba(0, 0, 0, 0.55)';
    ctx.shadowBlur = size * 0.15;
  }
  lines.forEach((line, i) => ctx.fillText(line, x, (i - (lines.length - 1) / 2) * lineH, w));
}

function drawShape(ctx: Ctx, p: Project, clip: Clip, w: number, h: number, scale: number): void {
  const s = clip.shape!;
  const line = Math.max(1, s.width * p.height * scale);
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = line;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  if (s.kind === 'arrow') {
    const head = Math.min(h, line * 4.5, w / 2);
    ctx.beginPath();
    ctx.moveTo(-w / 2, 0);
    ctx.lineTo(w / 2 - head * 0.6, 0);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2 - head, -head * 0.55);
    ctx.lineTo(w / 2 - head, head * 0.55);
    ctx.closePath();
    ctx.fill();
    return;
  }
  ctx.beginPath();
  if (s.kind === 'ellipse') ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2);
  else ctx.roundRect(-w / 2, -h / 2, w, h, Math.min(w, h) * 0.06);
  if (s.fill) ctx.fill();
  else ctx.stroke();
}

let scratch: OffscreenCanvas | null = null;

function drawEffect(ctx: Ctx, p: Project, clip: Clip, tRel: number): void {
  const e = clip.effect;
  if (!e) return;
  const place = placeOf(p, clip, tRel);
  const w = (clip.w ?? 0.3) * p.width * place.scale;
  const h = (clip.h ?? 0.15) * p.height * place.scale;
  if (place.alpha <= 0 || w < 2 || h < 2) return;
  const x = place.cx - w / 2;
  const y = place.cy - h / 2;
  const m = ctx.getTransform();
  const canvas = ctx.canvas;
  const px = m.a * x + m.e;
  const py = m.d * y + m.f;
  const pw = m.a * w;
  const ph = m.d * h;
  ctx.save();
  ctx.globalAlpha = place.alpha;
  ctx.beginPath();
  ctx.rect(x, y, w, h);
  ctx.clip();
  if (e.kind === 'blur') {
    ctx.filter = `blur(${(e.strength * p.height) / 1080}px)`;
    ctx.drawImage(canvas, 0, 0, canvas.width, canvas.height, 0, 0, p.width, p.height);
  } else {
    const cell = Math.max(2, (e.strength * p.height) / 1080);
    const tw = Math.max(1, Math.round(w / cell));
    const th = Math.max(1, Math.round(h / cell));
    scratch ??= new OffscreenCanvas(tw, th);
    scratch.width = tw;
    scratch.height = th;
    const s = scratch.getContext('2d')!;
    s.drawImage(canvas, px, py, pw, ph, 0, 0, tw, th);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(scratch, 0, 0, tw, th, x, y, w, h);
  }
  ctx.restore();
}
