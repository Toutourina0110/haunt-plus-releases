import type { Box, Card } from '../../shared/types';
import { motionTokens } from './tokens';

export interface Pixels {
  data: Uint8Array | Uint8ClampedArray;
  width: number;
  height: number;
  bgr: boolean;
}

export function pickCards(boxes: Box[], px: Pixels, view: { w: number; h: number }): Card[] {
  const t = motionTokens.cards;
  const scale = px.width / view.w;
  const inside = boxes.filter(
    (b) =>
      b.w >= t.minW &&
      b.h >= t.minH &&
      b.w * b.h <= view.w * view.h * t.maxShare &&
      b.x >= 0 &&
      b.y >= 0 &&
      b.x + b.w <= view.w &&
      b.y + b.h <= view.h,
  );
  const alone = inside.filter((b) => !boxes.some((o) => o !== b && overlaps(o, b)));
  alone.sort((a, b) => b.w * b.h - a.w * a.h);
  const cards: Card[] = [];
  for (const box of alone) {
    if (cards.length >= t.max) break;
    const fill = flatAround(box, px, scale);
    if (fill) cards.push({ box, fill });
  }
  return cards;
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

function flatAround(b: Box, px: Pixels, scale: number): string | null {
  const { ring, samples, tolerance } = motionTokens.cards;
  const x0 = b.x - ring;
  const y0 = b.y - ring;
  const x1 = b.x + b.w + ring;
  const y1 = b.y + b.h + ring;
  const points: Array<[number, number]> = [];
  for (let i = 0; i < samples; i++) {
    const f = (i + 0.5) / samples;
    const x = x0 + (x1 - x0) * f;
    const y = y0 + (y1 - y0) * f;
    points.push([x, y0], [x, y1], [x0, y], [x1, y]);
  }
  const r: number[] = [];
  const g: number[] = [];
  const bl: number[] = [];
  for (const [x, y] of points) {
    const px0 = Math.round(x * scale);
    const py0 = Math.round(y * scale);
    if (px0 < 0 || py0 < 0 || px0 >= px.width || py0 >= px.height) continue;
    const i = (py0 * px.width + px0) * 4;
    r.push(px.data[i]);
    g.push(px.data[i + 1]);
    bl.push(px.data[i + 2]);
  }
  if (r.length < samples * 2) return null;
  const mr = median(r);
  const mg = median(g);
  const mb = median(bl);
  for (let i = 0; i < r.length; i++) {
    if (Math.max(Math.abs(r[i] - mr), Math.abs(g[i] - mg), Math.abs(bl[i] - mb)) > tolerance) return null;
  }
  return px.bgr ? `rgb(${mb} ${mg} ${mr})` : `rgb(${mr} ${mg} ${mb})`;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1];
}

export function projectOnGradient(box: Box, w: number, h: number, angle: number): number {
  const a = (angle * Math.PI) / 180;
  const dx = Math.sin(a);
  const dy = -Math.cos(a);
  const length = Math.abs(w * dx) + Math.abs(h * dy);
  const cx = box.x + box.w / 2 - w / 2;
  const cy = box.y + box.h / 2 - h / 2;
  return (cx * dx + cy * dy) / length + 0.5;
}

export function solveEase(ease: (p: number) => number, value: number): number {
  if (value <= ease(0)) return 0;
  if (value >= ease(1)) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (ease(mid) < value) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}

export function rectIn(el: Element, stage: Element): Box {
  const r = el.getBoundingClientRect();
  const s = stage.getBoundingClientRect();
  return { x: r.left - s.left, y: r.top - s.top, w: r.width, h: r.height };
}
