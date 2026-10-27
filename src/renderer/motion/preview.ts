import { gsap } from 'gsap';
import { palette } from '../../shared/palette';
import { DEFAULT_PARAMS, SPEED_MS } from '../../shared/tile-params';
import { isGlMode, isStageMode, type AnimationMode, type Box, type GlMode, type TabId, type TransitionSpeed } from '../../shared/types';
import { TileMorph, type Mark, type Shot } from '../tiles';
import type { GlEngine } from './gl/engine';
import { scenes } from './gl';
import { GlMorph } from './gl/morph';
import { prepareExecution } from './execution';
import { EXECUTION } from './execution-params';
import { motionTokens } from './tokens';
import { transitions } from './transitions';

export interface PreviewEnv {
  dark: () => boolean;
  speed: () => TransitionSpeed;
  marks: () => Promise<Record<TabId, Mark> | null>;
  reduced: () => boolean;
  gl: () => GlEngine | null;
}

const GL_TUNE: Record<GlMode, Record<string, number>> = {
  prism: { minBlades: 8, maxBlades: 8 },
  fracture: { shards: 30 },
  dust: { particles: 900 },
  execution: { splatter: 25, chips: 70 },
};
let glOwner: Preview | null = null;

const HEADER: Box = { x: 0.06, y: 0.08, w: 0.88, h: 0.1 };
const CARDS: Box[] = [
  { x: 0.06, y: 0.26, w: 0.42, h: 0.3 },
  { x: 0.52, y: 0.26, w: 0.42, h: 0.3 },
  { x: 0.06, y: 0.62, w: 0.88, h: 0.28 },
];
const PAGES: [TabId, TabId] = ['haunt', 'tools'];
const LOOP_MS = 2400;
const TILE_ZOOM = 3;

export class Preview {
  readonly el: HTMLElement;
  private panels: [HTMLElement, HTMLElement];
  private ctx: gsap.Context | null = null;
  private morph: { abort: () => void } | null = null;
  private timer = 0;
  private runs = 0;
  private looping = false;
  private visible = true;

  constructor(
    private readonly mode: AnimationMode,
    private readonly env: PreviewEnv,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'tp-stage';
    this.el.setAttribute('aria-hidden', 'true');
    if (isStageMode(mode)) this.el.dataset.transition = mode;
    this.panels = [this.page(PAGES[0]), this.page(PAGES[1])];
    this.el.append(...this.panels);
    this.rest();
    new IntersectionObserver(([entry]) => {
      this.visible = entry.isIntersecting;
      if (!this.visible) this.loop(false);
    }).observe(this.el);
  }

  repaint(): void {
    this.rest();
    const panels: [HTMLElement, HTMLElement] = [this.page(PAGES[0]), this.page(PAGES[1])];
    this.panels.forEach((old, i) => old.replaceWith(panels[i]));
    this.panels = panels;
    this.rest();
  }

  loop(on: boolean): void {
    window.clearTimeout(this.timer);
    this.looping = on && this.visible && !this.env.reduced();
    if (this.looping) this.tick();
  }

  private get loopMs(): number {
    return this.mode === 'execution' ? EXECUTION.dark.end * 1000 + 600 : LOOP_MS;
  }

  play(): void {
    if (this.env.reduced() || !this.visible) return;
    this.rest();
    const speed = this.env.speed();
    if (isGlMode(this.mode) && this.env.gl()) {
      void this.webgl(this.mode, speed);
      return;
    }
    if (this.mode === 'full' || isGlMode(this.mode)) {
      void this.tiles(speed);
      return;
    }
    const [from, to] = this.panels;
    const fade = this.mode === 'simple';
    from.dataset.state = fade ? 'entering' : 'leaving';
    to.dataset.state = fade ? 'leaving' : 'entering';
    this.ctx = gsap.context(() => {
      if (isStageMode(this.mode)) {
        const w = this.el.clientWidth;
        const tl = transitions[this.mode].run({
          stage: this.el,
          from,
          to,
          direction: 1,
          originRect: { x: w * 0.3, y: -8, w: w * 0.12, h: 8 },
          dark: this.env.dark(),
        });
        tl.timeScale(motionTokens.speed[speed]);
      } else if (this.mode === 'simple') {
        gsap.fromTo(from, { opacity: 1 }, { opacity: 0, duration: 0.22, ease: 'power1.out' });
      }
    }, this.el);
  }

  private tick(): void {
    if (!this.looping) return;
    this.play();
    this.timer = window.setTimeout(() => this.tick(), this.loopMs);
  }

  private rest(): void {
    this.runs++;
    this.ctx?.revert();
    this.ctx = null;
    this.morph?.abort();
    this.morph = null;
    if (glOwner === this) glOwner = null;
    this.el.querySelectorAll('.tp-tiles, .tp-gl').forEach((el) => el.remove());
    this.panels[0].dataset.state = 'leaving';
    this.panels[1].dataset.state = 'inactive';
  }

  private page(tab: TabId): HTMLElement {
    const p = palette(tab, this.env.dark());
    const panel = document.createElement('div');
    panel.className = 'panel';
    panel.style.backgroundColor = p.bg;
    const content = document.createElement('div');
    content.className = 'panel-content';
    const cards = document.createElement('div');
    cards.className = 'panel-cards';
    content.append(block(HEADER, p.surface), cards);
    CARDS.forEach((box, i) => {
      const card = block(box, i === 0 ? `color-mix(in srgb, ${p.accent} 35%, ${p.raised})` : p.raised);
      card.dataset.motion = 'item';
      cards.append(card);
    });
    panel.append(content);
    return panel;
  }

  private async webgl(mode: GlMode, speed: TransitionSpeed): Promise<void> {
    const run = this.runs;
    const marks = await this.env.marks();
    const engine = this.env.gl();
    if (!marks || !engine || run !== this.runs) return;
    if (mode === 'execution') await prepareExecution(marks);
    if (run !== this.runs) return;
    glOwner?.rest();
    glOwner = this;
    const canvas = document.createElement('canvas');
    canvas.className = 'tp-gl';
    this.el.append(canvas);
    this.morph = await playGl(this, canvas, engine, mode, speed, marks, this.env.dark());
  }

  private async tiles(speed: TransitionSpeed): Promise<void> {
    const run = this.runs;
    const marks = await this.env.marks();
    if (!marks || run !== this.runs) return;
    const canvas = document.createElement('canvas');
    canvas.className = 'tp-tiles';
    this.el.append(canvas);
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    const dark = this.env.dark();
    const [a, b] = PAGES;
    const shots = [fakeShot(a, dark, w, h), fakeShot(b, dark, w, h)];
    const morph = new TileMorph({
      kind: 'switch',
      canvas,
      from: { mark: marks[a], bg: palette(a, dark).bg, shot: shots[0] },
      to: { mark: marks[b], bg: palette(b, dark).bg },
      dark,
      params: { ...DEFAULT_PARAMS, tiles: 60, duration: SPEED_MS[speed] },
      sweepRight: true,
    });
    this.morph = morph;
    morph.drawStart();
    morph.setTarget(shots[1]);
    await morph.play();
    for (const shot of shots) shot.bitmap?.close();
  }
}

async function playGl(preview: Preview, view: HTMLCanvasElement, engine: GlEngine, mode: GlMode, speed: TransitionSpeed, marks: Record<TabId, Mark>, dark: boolean): Promise<GlMorph> {
  const w = view.clientWidth * TILE_ZOOM;
  const h = view.clientHeight * TILE_ZOOM;
  const dpr = (window.devicePixelRatio || 1) / TILE_ZOOM;
  view.width = Math.max(1, Math.round(view.clientWidth * (window.devicePixelRatio || 1)));
  view.height = Math.max(1, Math.round(view.clientHeight * (window.devicePixelRatio || 1)));
  const g = view.getContext('2d')!;
  const [a, b] = PAGES;
  const shots = [fakeShot(a, dark, w, h), fakeShot(b, dark, w, h)];
  const morph = new GlMorph({
    engine,
    scene: scenes[mode],
    mode,
    w,
    h,
    dpr,
    dark,
    duration: mode === 'execution' ? EXECUTION.dark.end * 1000 : SPEED_MS[speed],
    from: { site: a, mark: marks[a], shot: shots[0] },
    to: { site: b, mark: marks[b] },
    origin: { x: w * 0.3, y: -24, w: w * 0.12, h: 24 },
    tune: GL_TUNE[mode],
    onFrame: () => {
      if (glOwner !== preview) return;
      g.clearRect(0, 0, view.width, view.height);
      g.drawImage(engine.canvas, 0, 0, view.width, view.height);
    },
  });
  morph.setTarget(shots[1]);
  void morph.play().then(() => shots.forEach((s) => s.bitmap?.close()));
  return morph;
}

function block(box: Box, color: string): HTMLElement {
  const el = document.createElement('div');
  el.className = 'tp-block';
  Object.assign(el.style, {
    left: `${box.x * 100}%`,
    top: `${box.y * 100}%`,
    width: `${box.w * 100}%`,
    height: `${box.h * 100}%`,
    backgroundColor: color,
  });
  return el;
}

function fakeShot(tab: TabId, dark: boolean, w: number, h: number): Shot {
  const p = palette(tab, dark);
  const canvas = new OffscreenCanvas(Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
  const g = canvas.getContext('2d')!;
  g.fillStyle = p.bg;
  g.fillRect(0, 0, w, h);
  const boxes = [HEADER, ...CARDS].map((f) => ({ x: f.x * w, y: f.y * h, w: f.w * w, h: f.h * h }));
  boxes.forEach((r, i) => {
    g.fillStyle = i === 0 ? p.surface : p.raised;
    g.beginPath();
    g.roundRect(r.x, r.y, r.w, r.h, 4 * TILE_ZOOM);
    g.fill();
  });
  return { bitmap: canvas.transferToImageBitmap(), boxes };
}
