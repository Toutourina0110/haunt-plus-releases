import { palette } from '../../../shared/palette';
import type { Box, GlMode, TabId } from '../../../shared/types';
import { MARK_MAP, markRect, type Mark, type MorphStats, type Shot } from '../../tiles';
import type { GlEngine, Rgb } from './engine';
import { mulberry32, ramp, rgbOf, seedOf } from './math';

export interface Side {
  site: TabId;
  mark: Mark;
  bg: Rgb;
  color: Rgb;
}

export interface Kit {
  engine: GlEngine;
  w: number;
  h: number;
  dark: boolean;
  dir: 1 | -1;
  rng: () => number;
  from: Side;
  to: Side;
  ramp: Rgb[];
  origin: Box | null;
  fromShot: Shot | null;
  toShot: Shot | null;
  logo: (mark: Mark) => { x: number; y: number; size: number };
  blur: (shot: Shot | null, bg: Rgb, px: number) => WebGLTexture;
}

export interface Scene {
  camera: number;
  need: number;
  count: number;
  draw: (t: number, frame: number) => void;
  target?: () => void;
  reduce?: () => string | null;
  dispose?: () => void;
}

export type SceneMaker = (kit: Kit, tune: Record<string, number>) => Scene;

export interface GlMorphOptions {
  engine: GlEngine;
  scene: SceneMaker;
  mode: GlMode;
  w: number;
  h: number;
  dpr: number;
  dark: boolean;
  duration: number;
  speed?: number;
  from: { site: TabId; mark: Mark; shot: Shot | null };
  to: { site: TabId; mark: Mark };
  origin: Box | null;
  tune?: Record<string, number>;
  log?: (message: string) => void;
  onFrame?: () => void;
  start?: number;
}

const LATE_MS = 20;
const ADAPT_FRAMES = 10;
const ADAPT_MS = 14;

export class GlMorph {
  readonly prepMs: number;
  private readonly kit: Kit;
  private readonly scene: Scene;
  private t = 0;
  private frame = 0;
  private raf = 0;
  private ready = false;
  private finished = false;
  private resolve: ((stats: MorphStats) => void) | null = null;
  private drawSum = 0;
  private gapSum = 0;
  private gaps = 0;
  private readonly stats: MorphStats;

  constructor(private readonly o: GlMorphOptions) {
    const began = performance.now();
    const engine = o.engine;
    engine.release();
    const side = (site: TabId, mark: Mark): Side => ({
      site,
      mark,
      bg: rgbOf(palette(site, o.dark).bg),
      color: [mark.rgb[0] / 255, mark.rgb[1] / 255, mark.rgb[2] / 255],
    });
    const from = side(o.from.site, o.from.mark);
    const to = side(o.to.site, o.to.mark);
    this.kit = {
      engine,
      w: o.w,
      h: o.h,
      dark: o.dark,
      dir: o.to.site === 'tools' ? 1 : -1,
      rng: mulberry32(seedOf(`${o.mode}:${o.from.site}>${o.to.site}`)),
      from,
      to,
      ramp: ramp(from.color, to.color),
      origin: o.origin,
      fromShot: o.from.shot,
      toShot: null,
      logo: (mark) => {
        const r = markRect(mark, o.w, o.h);
        return { x: r.x, y: r.y, size: MARK_MAP * r.k };
      },
      blur: (shot, bg, px) => blurTexture(engine, shot, bg, px, o.w, o.h),
    };
    engine.tex.from = o.from.shot?.bitmap ? engine.texture(o.from.shot.bitmap) : engine.flatTexture(from.bg);
    engine.tex.to = engine.flatTexture(to.bg);
    this.scene = o.scene(this.kit, o.tune ?? {});
    engine.resize(o.w, o.h, o.dpr, this.scene.camera);
    this.t = o.start ?? 0;
    this.prepMs = performance.now() - began;
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
      tiles: this.scene.count,
      fromCount: o.from.shot?.boxes.length ?? 0,
      fromGrid: false,
      toCount: 0,
      toGrid: false,
    };
  }

  setTarget(shot: Shot | null): void {
    if (this.ready || this.finished) return;
    const engine = this.o.engine;
    if (shot?.bitmap) {
      if (engine.tex.to) engine.gl.deleteTexture(engine.tex.to);
      engine.tex.to = engine.texture(shot.bitmap);
    }
    this.kit.toShot = shot;
    this.scene.target?.();
    this.ready = true;
    this.stats.toCount = shot?.boxes.length ?? 0;
    this.stats.targetAt = this.t;
  }

  drawStart(): void {
    this.draw(this.t);
  }

  drawAt(t: number): void {
    this.draw(t);
  }

  play(): Promise<MorphStats> {
    return new Promise((resolve) => {
      this.resolve = resolve;
      if (this.finished) return this.end(this.stats.aborted);
      const speed = this.o.speed ?? 1;
      let last = 0;
      const step = (now: number) => {
        if (this.finished) return;
        if (!this.o.engine.ok) return this.abort();
        if (last) {
          const gap = now - last;
          this.gapSum += gap;
          this.gaps++;
          this.stats.gapMax = Math.max(this.stats.gapMax, gap);
          if (gap > LATE_MS) this.stats.late++;
          let next = this.t + (gap * speed) / this.o.duration;
          if (!this.ready && next > this.scene.need) {
            this.stats.waited += gap;
            next = Math.max(this.t, this.scene.need);
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
        if (this.stats.frames === ADAPT_FRAMES) this.adapt();
        if (this.t >= 1) return this.end(false);
        this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }

  abort(): void {
    if (this.finished) return;
    cancelAnimationFrame(this.raf);
    this.end(true);
  }

  private adapt(): void {
    const draw = this.drawSum / this.stats.frames;
    const gap = this.gaps ? this.gapSum / this.gaps : 0;
    if (draw <= ADAPT_MS && gap <= 25) return;
    const note = this.scene.reduce?.();
    if (note) this.o.log?.(`${this.o.mode}: ${note} (draw ${draw.toFixed(1)} ms, frame ${gap.toFixed(1)} ms)`);
  }

  private draw(t: number): void {
    this.o.engine.begin();
    this.scene.draw(t, this.frame++);
    this.o.onFrame?.();
  }

  private end(aborted: boolean): void {
    this.finished = true;
    const engine = this.o.engine;
    if (aborted && engine.ok) {
      engine.clear();
      this.o.onFrame?.();
    }
    this.scene.dispose?.();
    engine.release();
    const s = this.stats;
    s.aborted = aborted;
    s.drawAvg = s.frames ? this.drawSum / s.frames : 0;
    s.gapAvg = this.gaps ? this.gapSum / this.gaps : 0;
    this.resolve?.({ ...s });
    this.resolve = null;
  }
}

function blurTexture(engine: GlEngine, shot: Shot | null, bg: Rgb, px: number, w: number, h: number): WebGLTexture {
  if (!shot?.bitmap || px <= 0) return shot?.bitmap ? engine.texture(shot.bitmap) : engine.flatTexture(bg);
  const q = 0.25;
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w * q)), Math.max(1, Math.round(h * q)));
  const g = canvas.getContext('2d')!;
  g.filter = `blur(${px * q}px)`;
  const z = 1.08;
  g.drawImage(shot.bitmap, ((1 - z) / 2) * canvas.width, ((1 - z) / 2) * canvas.height, canvas.width * z, canvas.height * z);
  return engine.texture(canvas);
}
