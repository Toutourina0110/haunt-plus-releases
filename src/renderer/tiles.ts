import type { TileParams } from '../shared/tile-params';
import type { Box } from '../shared/types';

const MAP = 512;
const MIN_ELEMENTS = 8;

export interface Mark {
  rgb: [number, number, number];
  css: string;
  image: HTMLCanvasElement;
  presence: Float64Array;
  weight: Float64Array;
  box: { x0: number; y0: number; x1: number; y1: number };
  cells: Map<number, Cell[]>;
}

interface Cell {
  x: number;
  y: number;
  s: number;
  a: number;
}

const smooth = (a: number, b: number, v: number): number => {
  const u = clamp01((v - a) / (b - a));
  return u * u * (3 - 2 * u);
};
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
const ease = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);

export async function loadMark(file: Blob): Promise<Mark> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = MAP;
    const g = canvas.getContext('2d', { willReadFrequently: true })!;
    g.drawImage(img, 0, 0, MAP, MAP);
    const pixels = g.getImageData(0, 0, MAP, MAP);
    const d = pixels.data;
    const count = MAP * MAP;

    const chroma = new Float32Array(count);
    let top = 0;
    for (let i = 0; i < count; i++) {
      const r = d[i * 4];
      const gr = d[i * 4 + 1];
      const b = d[i * 4 + 2];
      chroma[i] = (Math.max(r, gr, b) - Math.min(r, gr, b)) / 255;
      if (d[i * 4 + 3] > 230 && chroma[i] > top) top = chroma[i];
    }
    let sr = 0;
    let sg = 0;
    let sb = 0;
    let n = 0;
    for (let i = 0; i < count; i++) {
      if (d[i * 4 + 3] > 230 && chroma[i] >= top * 0.97) {
        sr += d[i * 4];
        sg += d[i * 4 + 1];
        sb += d[i * 4 + 2];
        n++;
      }
    }
    const rgb: [number, number, number] = n ? [Math.round(sr / n), Math.round(sg / n), Math.round(sb / n)] : [128, 128, 128];

    const presence = new Float32Array(count);
    const weight = new Float32Array(count);
    let x0 = MAP;
    let y0 = MAP;
    let x1 = 0;
    let y1 = 0;
    for (let i = 0; i < count; i++) {
      const a = d[i * 4 + 3] / 255;
      const rel = top > 0 ? chroma[i] / top : 0;
      presence[i] = a * smooth(0.08, 0.2, rel);
      weight[i] = presence[i] * Math.min(1, rel);
      if (presence[i] > 0.5) {
        const x = i % MAP;
        const y = (i - x) / MAP;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
      }
      d[i * 4] = rgb[0];
      d[i * 4 + 1] = rgb[1];
      d[i * 4 + 2] = rgb[2];
      d[i * 4 + 3] = Math.round(weight[i] * 255);
    }
    g.putImageData(pixels, 0, 0);
    if (x1 < x0) [x0, y0, x1, y1] = [0, 0, MAP - 1, MAP - 1];

    return {
      rgb,
      css: `rgb(${rgb.join(',')})`,
      image: canvas,
      presence: summed(presence),
      weight: summed(weight),
      box: { x0, y0, x1: x1 + 1, y1: y1 + 1 },
      cells: new Map(),
    };
  } finally {
    URL.revokeObjectURL(url);
  }
}

function summed(v: Float32Array): Float64Array {
  const s = MAP + 1;
  const t = new Float64Array(s * s);
  for (let y = 0; y < MAP; y++) {
    let row = 0;
    for (let x = 0; x < MAP; x++) {
      row += v[y * MAP + x];
      t[(y + 1) * s + x + 1] = t[y * s + x + 1] + row;
    }
  }
  return t;
}

function area(t: Float64Array, x0: number, y0: number, x1: number, y1: number): number {
  const s = MAP + 1;
  return t[y1 * s + x1] - t[y0 * s + x1] - t[y1 * s + x0] + t[y0 * s + x0];
}

function grid(mark: Mark, step: number): Array<Cell & { p: number }> {
  const { x0, y0, x1, y1 } = mark.box;
  const cols = Math.ceil((x1 - x0) / step);
  const rows = Math.ceil((y1 - y0) / step);
  const left = (x0 + x1) / 2 - (cols * step) / 2;
  const top = (y0 + y1) / 2 - (rows * step) / 2;
  const out: Array<Cell & { p: number }> = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const ax = left + c * step;
      const ay = top + r * step;
      const ix0 = Math.max(0, Math.round(ax));
      const iy0 = Math.max(0, Math.round(ay));
      const ix1 = Math.min(MAP, Math.round(ax + step));
      const iy1 = Math.min(MAP, Math.round(ay + step));
      const size = (ix1 - ix0) * (iy1 - iy0);
      if (size <= 0) continue;
      const p = area(mark.presence, ix0, iy0, ix1, iy1);
      if (p / size < 0.42) continue;
      const w = area(mark.weight, ix0, iy0, ix1, iy1);
      out.push({ x: ax + step / 2, y: ay + step / 2, s: step, a: Math.min(1, w / p), p: p / size });
    }
  }
  return out;
}

function sampleCells(mark: Mark, n: number): Cell[] {
  const cached = mark.cells.get(n);
  if (cached) return cached;
  let lo = 1.5;
  let hi = MAP / 3;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (grid(mark, mid).length >= n) lo = mid;
    else hi = mid;
  }
  const cells = grid(mark, lo)
    .sort((a, b) => b.p - a.p)
    .slice(0, n)
    .map(({ x, y, s, a }) => ({ x, y, s, a }));
  mark.cells.set(n, cells);
  return cells;
}

function makePieces(boxes: Box[], n: number): Box[] {
  const list = [...boxes].sort((a, b) => b.w * b.h - a.w * a.h).slice(0, Math.max(1, Math.floor(n / 2)));
  const total = list.reduce((sum, b) => sum + b.w * b.h, 0) || 1;
  const spare = n - list.length;
  const raw = list.map((b) => (spare * b.w * b.h) / total);
  const alloc = raw.map((v) => 1 + Math.floor(v));
  let left = n - alloc.reduce((sum, v) => sum + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), i]).sort((a, b) => b[0] - a[0]);
  for (let k = 0; left > 0; k++, left--) alloc[order[k % order.length][1]]++;

  const out: Box[] = [];
  list.forEach((b, i) => {
    const k = alloc[i];
    const cols = Math.min(k, Math.max(1, Math.round(Math.sqrt((k * b.w) / b.h))));
    const rows = Math.max(1, Math.floor(k / cols));
    const w = b.w / cols;
    const h = b.h / rows;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: b.x + c * w, y: b.y + r * h, w, h });
  });
  while (out.length < n) {
    let big = 0;
    for (let i = 1; i < out.length; i++) if (out[i].w * out[i].h > out[big].w * out[big].h) big = i;
    const b = out[big];
    if (b.w >= b.h) {
      out[big] = { ...b, w: b.w / 2 };
      out.push({ ...b, x: b.x + b.w / 2, w: b.w / 2 });
    } else {
      out[big] = { ...b, h: b.h / 2 };
      out.push({ ...b, y: b.y + b.h / 2, h: b.h / 2 });
    }
  }
  return out.slice(0, n);
}

interface Pt {
  x: number;
  y: number;
}

function match(a: Pt[], b: Pt[]): Int32Array {
  const polar = (pts: Pt[]) => {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const p of pts) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    const hw = Math.max(1, (maxX - minX) / 2);
    const hh = Math.max(1, (maxY - minY) / 2);
    return pts.map((p, i) => {
      const dx = (p.x - cx) / hw;
      const dy = (p.y - cy) / hh;
      return { i, r: Math.hypot(dx, dy), t: Math.atan2(dy, dx) };
    });
  };
  const byR = (p: { r: number }, q: { r: number }) => p.r - q.r;
  const byT = (p: { t: number }, q: { t: number }) => p.t - q.t;
  const pa = polar(a).sort(byR);
  const pb = polar(b).sort(byR);
  const ring = Math.max(4, Math.round(Math.sqrt(a.length) * 1.2));
  const out = new Int32Array(a.length);
  for (let s = 0; s < pa.length; s += ring) {
    const ca = pa.slice(s, s + ring).sort(byT);
    const cb = pb.slice(s, s + ring).sort(byT);
    ca.forEach((p, k) => (out[p.i] = cb[k].i));
  }
  return out;
}

export interface Shot {
  bitmap: ImageBitmap | null;
  boxes: Box[];
}

export interface MorphOptions {
  kind: 'switch' | 'intro';
  canvas: HTMLCanvasElement;
  from: { mark: Mark; bg: string; shot: Shot | null };
  to: { mark: Mark; bg: string };
  dark: boolean;
  params: TileParams;
  speed?: number;
  sweepRight?: boolean;
  forceGrid?: boolean;
  outlines?: boolean;
}

export interface MorphStats {
  aborted: boolean;
  frames: number;
  drawAvg: number;
  drawMax: number;
  gapAvg: number;
  gapMax: number;
  late: number;
  waited: number;
  targetAt: number;
  tiles: number;
  fromCount: number;
  fromGrid: boolean;
  toCount: number;
  toGrid: boolean;
}

interface Layer {
  bitmap: ImageBitmap | null;
  blurred: HTMLCanvasElement | null;
  pattern: CanvasPattern | null;
  scale: number;
  bg: string;
}

interface Tile {
  from: Box | null;
  a: Cell;
  b: Cell;
  to: Box | null;
  kFrom: number;
  kTo: number;
  kSweep: number;
  spin: number;
}

interface Timeline {
  gather: [number, number];
  morph: [number, number] | null;
  build: [number, number];
  fade: [number, number];
}

const SWITCH: Timeline = { gather: [0, 0.34], morph: [0.42, 0.6], build: [0.66, 1], fade: [0.36, 0.62] };
const INTRO: Timeline = { gather: [0, 0.34], morph: null, build: [0.46, 1], fade: [0.36, 0.62] };
const GAP = 1.5;
const LATE_MS = 20;
const SHADES = 64;

export class TileMorph {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly w: number;
  private readonly h: number;
  private readonly dpr: number;
  private readonly line: Timeline;
  private readonly tiles: Tile[] = [];
  private readonly fromLayer: Layer | null;
  private toLayer: Layer | null = null;
  private readonly logo: { size: number; a: Mark; b: Mark };
  private readonly shades: string[] = [];
  private readonly m = new DOMMatrix();
  private t = 0;
  private raf = 0;
  private finished = false;
  private resolve: ((stats: MorphStats) => void) | null = null;
  private readonly stats: MorphStats;
  private drawSum = 0;
  private gapSum = 0;
  private gaps = 0;

  constructor(private readonly o: MorphOptions) {
    const canvas = o.canvas;
    this.dpr = window.devicePixelRatio || 1;
    this.w = canvas.clientWidth;
    this.h = canvas.clientHeight;
    canvas.width = Math.round(this.w * this.dpr);
    canvas.height = Math.round(this.h * this.dpr);
    this.ctx = canvas.getContext('2d')!;
    this.ctx.imageSmoothingQuality = 'high';
    this.line = o.kind === 'intro' ? INTRO : SWITCH;

    const a = o.from.mark;
    const b = o.kind === 'intro' ? a : o.to.mark;
    this.logo = { size: Math.min(280, Math.max(120, Math.min(this.w, this.h) * 0.34)), a, b };
    for (let i = 0; i <= SHADES; i++) {
      const k = i / SHADES;
      this.shades.push(`rgb(${a.rgb.map((v, j) => Math.round(lerp(v, b.rgb[j], k))).join(',')})`);
    }

    const cellsA = this.place(a, sampleCells(a, o.params.tiles));
    const cellsB = o.kind === 'intro' ? cellsA : this.place(b, sampleCells(b, o.params.tiles));
    const n = Math.min(cellsA.length, cellsB.length);
    const ca = cellsA.slice(0, n);
    const cb = cellsB.slice(0, n);
    const ab = o.kind === 'intro' ? Int32Array.from(ca.keys()) : match(ca, cb);

    const shot = o.from.shot;
    this.fromLayer = shot ? this.layer(shot.bitmap, o.from.bg) : null;
    const from = shot ? this.pieces(shot.boxes, n) : null;
    const fromOf = from ? match(ca, from.pieces.map(center)) : null;

    let minX = Infinity;
    let maxX = -Infinity;
    for (const c of ca) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
    }
    const right = o.sweepRight ?? true;
    for (let i = 0; i < n; i++) {
      const piece = from && fromOf ? from.pieces[fromOf[i]] : null;
      const sweep = (ca[i].x - minX) / Math.max(1, maxX - minX);
      this.tiles.push({
        from: piece,
        a: ca[i],
        b: cb[ab[i]],
        to: null,
        kFrom: piece ? this.reach(center(piece)) : this.reach(ca[i]),
        kTo: 0,
        kSweep: right ? sweep : 1 - sweep,
        spin: 0.6 + 0.4 * hash(i),
      });
    }

    this.stats = {
      aborted: false,
      frames: 0,
      drawAvg: 0,
      drawMax: 0,
      gapAvg: 0,
      gapMax: 0,
      late: 0,
      waited: 0,
      targetAt: -1,
      tiles: n,
      fromCount: from?.count ?? 0,
      fromGrid: from?.grid ?? false,
      toCount: 0,
      toGrid: false,
    };
  }

  setTarget(shot: Shot | null): void {
    if (this.toLayer || this.finished) return;
    const boxes = shot?.boxes ?? [];
    const to = this.pieces(boxes, this.tiles.length);
    const of = match(
      this.tiles.map((tile) => tile.b),
      to.pieces.map(center),
    );
    this.tiles.forEach((tile, i) => {
      tile.to = to.pieces[of[i]];
      tile.kTo = this.reach(center(tile.to));
    });
    this.toLayer = this.layer(shot?.bitmap ?? null, this.o.to.bg);
    this.stats.toCount = to.count;
    this.stats.toGrid = to.grid;
    this.stats.targetAt = this.t;
  }

  drawStart(): void {
    this.draw(0);
  }

  play(): Promise<MorphStats> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      if (this.finished) return this.end(this.stats.aborted);
      const speed = this.o.speed ?? 1;
      const duration = this.o.params.duration;
      const need = this.line.fade[0];
      let last = 0;
      const step = (now: number) => {
        if (this.finished) return;
        if (last) {
          const gap = now - last;
          this.gapSum += gap;
          this.gaps++;
          this.stats.gapMax = Math.max(this.stats.gapMax, gap);
          if (gap > LATE_MS) this.stats.late++;
          let next = this.t + (gap * speed) / duration;
          if (!this.toLayer && next > need) {
            this.stats.waited += gap;
            next = Math.max(this.t, need);
          }
          this.t = Math.min(1, next);
        }
        last = now;
        const began = performance.now();
        this.draw(this.t);
        const spent = performance.now() - began;
        this.drawSum += spent;
        this.stats.frames++;
        this.stats.drawMax = Math.max(this.stats.drawMax, spent);
        if (this.t >= 1) return this.end(false);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  abort(): void {
    if (this.finished) return;
    cancelAnimationFrame(this.raf);
    this.clear();
    this.end(true);
  }

  clear(): void {
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.clearRect(0, 0, this.o.canvas.width, this.o.canvas.height);
  }

  private end(aborted: boolean): void {
    this.finished = true;
    const s = this.stats;
    s.aborted = aborted;
    s.drawAvg = s.frames ? this.drawSum / s.frames : 0;
    s.gapAvg = this.gaps ? this.gapSum / this.gaps : 0;
    this.resolve?.({ ...s });
    this.resolve = null;
  }

  private place(mark: Mark, cells: Cell[]): Cell[] {
    const { x0, y0, x1, y1 } = mark.box;
    const k = this.logo.size / Math.max(x1 - x0, y1 - y0);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    return cells.map((c) => ({ x: this.w / 2 + (c.x - cx) * k, y: this.h / 2 + (c.y - cy) * k, s: c.s * k, a: c.a }));
  }

  private pieces(boxes: Box[], n: number): { pieces: Box[]; count: number; grid: boolean } {
    const usable: Box[] = [];
    for (const b of boxes) {
      const x = Math.max(0, b.x);
      const y = Math.max(0, b.y);
      const w = Math.min(this.w, b.x + b.w) - x;
      const h = Math.min(this.h, b.y + b.h) - y;
      if (w >= 10 && h >= 10) usable.push({ x, y, w, h });
    }
    const grid = this.o.forceGrid || usable.length < MIN_ELEMENTS;
    const source = grid ? [{ x: 0, y: 0, w: this.w, h: this.h }] : usable;
    return { pieces: makePieces(source, n), count: usable.length, grid };
  }

  private reach(p: Pt): number {
    return clamp01(Math.hypot((p.x - this.w / 2) / (this.w / 2), (p.y - this.h / 2) / (this.h / 2)) / Math.SQRT2);
  }

  private layer(bitmap: ImageBitmap | null, bg: string): Layer {
    if (!bitmap) return { bitmap: null, blurred: null, pattern: null, scale: 1, bg };
    let blurred: HTMLCanvasElement | null = null;
    const blur = this.o.params.blur;
    if (blur > 0) {
      const q = 0.25;
      blurred = document.createElement('canvas');
      blurred.width = Math.max(1, Math.round(this.w * q));
      blurred.height = Math.max(1, Math.round(this.h * q));
      const g = blurred.getContext('2d')!;
      g.filter = `blur(${blur * q}px)`;
      const z = 1.08;
      g.drawImage(bitmap, ((1 - z) / 2) * blurred.width, ((1 - z) / 2) * blurred.height, blurred.width * z, blurred.height * z);
    }
    return {
      bitmap,
      blurred,
      pattern: this.ctx.createPattern(bitmap, 'no-repeat'),
      scale: bitmap.width / this.w,
      bg,
    };
  }

  private draw(t: number): void {
    const { ctx, line } = this;
    const cw = this.o.canvas.width;
    const ch = this.o.canvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.clearRect(0, 0, cw, ch);

    const cross = smooth(line.fade[0], line.fade[1], t);
    const out = smooth(0, 0.18, t);
    const into = 1 - smooth(line.build[0] + 0.06, 1, t);
    if (cross < 1) this.page(this.fromLayer, this.o.from.bg, 1, out);
    if (cross > 0) this.page(this.toLayer, this.o.to.bg, cross, into);

    const g = line.gather[1];
    const crispA = line.morph
      ? smooth(g - 0.03, g, t) * (1 - smooth(line.morph[0], line.morph[0] + 0.04, t))
      : smooth(g - 0.03, g, t) * (1 - smooth(line.build[0], line.build[0] + 0.04, t));
    const crispB = line.morph ? smooth(line.morph[1] - 0.03, line.morph[1], t) * (1 - smooth(line.build[0], line.build[0] + 0.04, t)) : 0;
    const crisp = Math.max(crispA, crispB);

    const hide = 1 - smooth(0.5, 1, crisp);
    if (hide > 0) for (const tile of this.tiles) this.tile(tile, t, hide);

    if (crispA > 0) this.mark(this.logo.a, smooth(0, 0.5, crispA));
    if (crispB > 0) this.mark(this.logo.b, smooth(0, 0.5, crispB));
  }

  private page(layer: Layer | null, bg: string, alpha: number, soft: number): void {
    const { ctx } = this;
    const cw = this.o.canvas.width;
    const ch = this.o.canvas.height;
    ctx.globalAlpha = alpha;
    if (!layer?.bitmap) {
      ctx.fillStyle = bg;
      ctx.fillRect(0, 0, cw, ch);
      return;
    }
    if (layer.blurred && soft > 0) ctx.drawImage(layer.blurred, 0, 0, cw, ch);
    const sharp = layer.blurred ? 1 - soft : 1;
    if (sharp > 0) {
      ctx.globalAlpha = alpha * sharp;
      ctx.drawImage(layer.bitmap, 0, 0, cw, ch);
    }
    if (soft > 0) {
      ctx.globalAlpha = alpha * soft * (this.o.dark ? 0.45 : 0.1);
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, cw, ch);
    }
  }

  private mark(mark: Mark, alpha: number): void {
    const { x0, y0, x1, y1 } = mark.box;
    const k = this.logo.size / Math.max(x1 - x0, y1 - y0);
    const { ctx, dpr } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = alpha;
    ctx.drawImage(mark.image, this.w / 2 - ((x0 + x1) / 2) * k, this.h / 2 - ((y0 + y1) / 2) * k, MAP * k, MAP * k);
  }

  private tile(tile: Tile, t: number, hide: number): void {
    const { line, o } = this;
    const p = o.params;
    const { a, b } = tile;
    let x: number;
    let y: number;
    let w: number;
    let h: number;
    let alpha: number;
    let content = 0;
    let env = 1;
    let turn = 0;
    let shade = 0;
    let src: Layer | null = null;
    let box: Box | null = null;

    const local = (span: [number, number], key: number, wave: number) =>
      clamp01((t - span[0] - key * wave * (span[1] - span[0])) / ((1 - wave) * (span[1] - span[0])));

    if (t < line.build[0] && (!line.morph || t < line.morph[0])) {
      const u = local(line.gather, tile.kFrom, p.wave);
      const e = ease(u);
      let x0: number;
      let y0: number;
      let w0: number;
      let h0: number;
      if (tile.from) {
        x0 = tile.from.x + tile.from.w / 2;
        y0 = tile.from.y + tile.from.h / 2;
        w0 = tile.from.w;
        h0 = tile.from.h;
        content = 1 - smooth(0.1, 0.7, u);
        alpha = lerp(1, a.a, smooth(0.5, 1, u));
        env = Math.min(1, u * 6);
        src = this.fromLayer;
        box = tile.from;
      } else {
        x0 = this.w / 2 + (a.x - this.w / 2) * 2.2;
        y0 = this.h / 2 + (a.y - this.h / 2) * 2.2;
        w0 = h0 = a.s * 0.4;
        alpha = a.a * smooth(0, 0.6, u);
      }
      [x, y] = this.path(x0, y0, a.x, a.y, e);
      w = lerp(w0, a.s, e);
      h = lerp(h0, a.s, e);
      turn = Math.sin(Math.PI * e);
    } else if (line.morph && t < line.build[0]) {
      const u = local(line.morph, tile.kSweep, Math.min(0.7, p.wave + 0.15));
      const e = ease(u);
      [x, y] = this.path(a.x, a.y, b.x, b.y, e);
      w = h = lerp(a.s, b.s, e);
      alpha = lerp(a.a, b.a, e);
      shade = e;
      turn = 0.6 * Math.sin(Math.PI * e);
    } else {
      const u = local(line.build, tile.kTo, p.wave);
      const e = ease(u);
      const to = tile.to ?? { x: b.x - b.s / 2, y: b.y - b.s / 2, w: b.s, h: b.s };
      [x, y] = this.path(b.x, b.y, to.x + to.w / 2, to.y + to.h / 2, e);
      w = lerp(b.s, to.w, e);
      h = lerp(b.s, to.h, e);
      alpha = lerp(b.a, 1, smooth(0, 0.5, u));
      src = this.toLayer;
      if (src?.bitmap) {
        content = smooth(0.3, 0.9, u);
        box = to;
      } else {
        alpha *= 1 - smooth(0.6, 1, u);
      }
      shade = 1;
      env = Math.min(1, (1 - u) * 6);
      turn = Math.sin(Math.PI * e);
    }

    alpha *= hide;
    if (alpha <= 0.002) return;
    const gap = GAP * env;
    w = Math.max(0.5, w - gap);
    h = Math.max(0.5, h - gap);
    const r = Math.min(p.radius, w / 2, h / 2) * env;
    const rot = ((p.rotation * Math.PI) / 180) * tile.spin * turn;

    const { ctx, dpr } = this;
    const cos = Math.cos(rot) * dpr;
    const sin = Math.sin(rot) * dpr;
    ctx.setTransform(cos, sin, -sin, cos, x * dpr, y * dpr);
    ctx.beginPath();
    if (r > 0.3) ctx.roundRect(-w / 2, -h / 2, w, h, r);
    else ctx.rect(-w / 2, -h / 2, w, h);

    const color = this.shades[Math.round(shade * SHADES)];
    if (content > 0.01 && src?.pattern && box) {
      const k = src.scale;
      const sx = w / (box.w * k);
      const sy = h / (box.h * k);
      const m = this.m;
      m.a = sx;
      m.b = 0;
      m.c = 0;
      m.d = sy;
      m.e = -(box.x + box.w / 2) * k * sx;
      m.f = -(box.y + box.h / 2) * k * sy;
      src.pattern.setTransform(m);
      ctx.fillStyle = src.pattern;
      ctx.globalAlpha = alpha;
      ctx.fill();
      if (content < 0.99) {
        ctx.fillStyle = color;
        ctx.globalAlpha = alpha * (1 - content);
        ctx.fill();
      }
    } else {
      ctx.fillStyle = color;
      ctx.globalAlpha = alpha;
      ctx.fill();
    }

    if (o.outlines) {
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.strokeStyle = o.dark ? '#ffffff' : '#000000';
      ctx.stroke();
    }
  }

  private path(x0: number, y0: number, x1: number, y1: number, e: number): [number, number] {
    const bend = this.o.params.curve;
    const dx = x1 - x0;
    const dy = y1 - y0;
    const qx = (x0 + x1) / 2 - dy * bend;
    const qy = (y0 + y1) / 2 + dx * bend;
    const v = 1 - e;
    return [v * v * x0 + 2 * v * e * qx + e * e * x1, v * v * y0 + 2 * v * e * qy + e * e * y1];
  }
}

function center(b: Box): Pt {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

function hash(i: number): number {
  return (((i + 1) * 2654435761) >>> 0) / 4294967296;
}
