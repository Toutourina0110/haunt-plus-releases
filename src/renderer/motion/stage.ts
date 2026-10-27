import { gsap } from 'gsap';
import { TABS, type Box, type Card, type StageMode, type TabId, type TransitionSpeed } from '../../shared/types';
import type { Shot } from '../tiles';
import { motionTokens } from './tokens';
import { transitions } from './transitions';

export type Picture = Shot & { cards: Card[] };

export interface Leg {
  mode: StageMode;
  speed: TransitionSpeed;
  fromSite: TabId;
  toSite: TabId;
  origin: Box | null;
}

export interface StageLook {
  dark: () => boolean;
  colors: (tab: TabId) => { stage: string; surface: string };
}

export class Stage {
  private readonly panels: [HTMLElement, HTMLElement];
  private toIndex = 1;
  private target: TabId | null = null;
  private ctx: gsap.Context | null = null;
  private done: (() => void) | null = null;

  constructor(
    private readonly root: HTMLElement,
    private readonly look: StageLook,
  ) {
    this.panels = [root.children[0] as HTMLElement, root.children[1] as HTMLElement];
  }

  private get from(): HTMLElement {
    return this.panels[1 - this.toIndex];
  }

  private get to(): HTMLElement {
    return this.panels[this.toIndex];
  }

  play(leg: Leg, from: Picture | null, to: Picture | null): Promise<void> {
    this.end();
    return new Promise((resolve) => {
      this.done = resolve;
      this.root.hidden = false;
      this.toIndex = 1;
      this.fill(this.from, from, leg.fromSite);
      this.fill(this.to, to, leg.toSite);
      this.start(leg);
    });
  }

  chain(leg: Leg, to: Picture | null): boolean {
    if (!this.done) return false;
    this.ctx?.revert();
    this.toIndex = 1 - this.toIndex;
    this.fill(this.to, to, leg.toSite);
    this.start(leg);
    return true;
  }

  refresh(tab: TabId, pic: Picture | null): boolean {
    if (!this.done || tab !== this.target) return false;
    if (!pic?.bitmap) return true;
    const panel = this.to;
    const cards = [...panel.querySelectorAll<HTMLElement>('[data-motion="item"]')];
    const kept: Card[] = cards.map((el) => ({ box: boxOf(el), fill: el.dataset.fill ?? '' }));
    const base = this.base(pic.bitmap, kept);
    const layers = [base, ...cards.map((el) => crop(pic.bitmap!, boxOf(el), this.scale(pic.bitmap!)))];
    panel.querySelector('.panel-cards')?.before(base);
    cards.forEach((el, i) => el.append(layers[i + 1]));
    this.ctx?.add(() => {
      gsap.fromTo(layers, { opacity: 0 }, { opacity: 1, duration: motionTokens.fresh, ease: 'power1.out' });
    });
    return true;
  }

  stop(): void {
    this.end();
  }

  private start(leg: Leg): void {
    this.target = leg.toSite;
    this.root.dataset.transition = leg.mode;
    this.root.style.setProperty('--stage-bg', this.look.colors(leg.toSite).stage);
    this.from.dataset.state = 'leaving';
    this.to.dataset.state = 'entering';
    const direction = TABS.indexOf(leg.toSite) >= TABS.indexOf(leg.fromSite) ? 1 : -1;
    let empty = false;
    this.ctx = gsap.context(() => {
      const tl = transitions[leg.mode].run({
        stage: this.root,
        from: this.from,
        to: this.to,
        direction,
        originRect: leg.origin,
        dark: this.look.dark(),
      });
      tl.timeScale(motionTokens.speed[leg.speed]);
      empty = tl.duration() === 0;
      if (!empty) tl.eventCallback('onComplete', () => this.handover());
    }, this.root);
    if (empty) this.handover();
  }

  private handover(): void {
    this.ctx?.add(() => {
      gsap.to(this.root, { opacity: 0, duration: motionTokens.handoff, ease: 'power1.out', onComplete: () => this.end() });
    });
  }

  private end(): void {
    this.root.hidden = true;
    delete this.root.dataset.transition;
    this.ctx?.revert();
    this.ctx = null;
    this.target = null;
    for (const panel of this.panels) this.clear(panel);
    const done = this.done;
    this.done = null;
    done?.();
  }

  private fill(panel: HTMLElement, pic: Picture | null, tab: TabId): void {
    this.clear(panel);
    panel.style.backgroundColor = this.look.colors(tab).surface;
    const content = document.createElement('div');
    content.className = 'panel-content';
    const cards = document.createElement('div');
    cards.className = 'panel-cards';
    if (pic?.bitmap) {
      const scale = this.scale(pic.bitmap);
      content.append(this.base(pic.bitmap, pic.cards));
      for (const card of pic.cards) {
        const el = document.createElement('div');
        el.className = 'panel-card';
        el.dataset.motion = 'item';
        el.dataset.fill = card.fill;
        Object.assign(el.style, {
          left: `${card.box.x}px`,
          top: `${card.box.y}px`,
          width: `${card.box.w}px`,
          height: `${card.box.h}px`,
        });
        el.append(crop(pic.bitmap, card.box, scale));
        cards.append(el);
      }
    }
    content.append(cards);
    panel.append(content);
  }

  private base(bitmap: ImageBitmap, cards: Card[]): HTMLCanvasElement {
    const canvas = document.createElement('canvas');
    canvas.className = 'panel-base';
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const g = canvas.getContext('2d')!;
    g.drawImage(bitmap, 0, 0);
    const k = this.scale(bitmap);
    for (const { box, fill } of cards) {
      g.fillStyle = fill;
      g.fillRect(Math.floor((box.x - 1) * k), Math.floor((box.y - 1) * k), Math.ceil((box.w + 2) * k), Math.ceil((box.h + 2) * k));
    }
    return canvas;
  }

  private scale(bitmap: ImageBitmap): number {
    return bitmap.width / (this.root.clientWidth || window.innerWidth);
  }

  private clear(panel: HTMLElement): void {
    for (const canvas of panel.querySelectorAll('canvas')) canvas.width = 0;
    panel.replaceChildren();
    panel.dataset.state = 'inactive';
  }
}

function crop(bitmap: ImageBitmap, box: Box, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(box.w * scale));
  canvas.height = Math.max(1, Math.round(box.h * scale));
  canvas.getContext('2d')!.drawImage(bitmap, box.x * scale, box.y * scale, box.w * scale, box.h * scale, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function boxOf(el: HTMLElement): Box {
  return { x: parseFloat(el.style.left), y: parseFloat(el.style.top), w: parseFloat(el.style.width), h: parseFloat(el.style.height) };
}
