export interface TourRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface TourStep {
  title: string;
  text: string;
  target?: () => TourRect | null;
  available?: () => boolean;
  enter?: () => void;
  leave?: () => void;
  bounds?: () => TourRect | null;
}

export interface TourLabels {
  next: string;
  prev: string;
  done: string;
  skip: string;
  count: (index: number, total: number) => string;
}

const PAD = 6;
const GAP = 14;
const MARGIN = 12;

let tour: {
  steps: TourStep[];
  labels: TourLabels;
  index: number;
  root: HTMLElement;
  hole: HTMLElement;
  card: HTMLElement;
  finish: () => void;
} | null = null;

export function tourActive(): boolean {
  return !!tour;
}

export function rectOf(el: Element | null | undefined): TourRect | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (r.width < 1 || r.height < 1) return null;
  return { x: r.left, y: r.top, w: r.width, h: r.height };
}

export function unionOf(els: Element[]): TourRect | null {
  const rects = els.map(rectOf).filter((r): r is TourRect => !!r);
  if (!rects.length) return null;
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  return { x, y, w: Math.max(...rects.map((r) => r.x + r.w)) - x, h: Math.max(...rects.map((r) => r.y + r.h)) - y };
}

export function runTour(steps: TourStep[], labels: TourLabels): Promise<void> {
  endTour();
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'tour';
    root.setAttribute('role', 'dialog');
    root.setAttribute('aria-modal', 'true');
    const hole = document.createElement('div');
    hole.className = 'tour-hole';
    const card = document.createElement('div');
    card.className = 'tour-card';
    card.setAttribute('aria-live', 'polite');
    root.append(hole, card);
    document.body.append(root);
    tour = { steps, labels, index: -1, root, hole, card, finish: resolve };
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('resize', refreshTour);
    move(0, 1);
  });
}

export function endTour(): void {
  if (!tour) return;
  const t = tour;
  tour = null;
  t.steps[t.index]?.leave?.();
  t.root.remove();
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('resize', refreshTour);
  t.finish();
}

export function refreshTour(): void {
  if (tour && tour.index >= 0) draw(tour.steps[tour.index]);
}

function onKey(event: KeyboardEvent): void {
  if (!tour) return;
  if (event.key === 'Escape') endTour();
  else if (event.key === 'ArrowRight' || event.key === 'Enter') move(tour.index + 1, 1);
  else if (event.key === 'ArrowLeft') move(tour.index - 1, -1);
  else return;
  event.preventDefault();
  event.stopPropagation();
}

function available(step: TourStep): boolean {
  return step.available ? step.available() : true;
}

function move(from: number, dir: 1 | -1): void {
  if (!tour) return;
  const t = tour;
  for (let i = from; i >= 0 && i < t.steps.length; i += dir) {
    if (!available(t.steps[i])) continue;
    t.steps[t.index]?.leave?.();
    t.index = i;
    t.steps[i].enter?.();
    requestAnimationFrame(() => tour === t && t.index === i && draw(t.steps[i]));
    return;
  }
  if (dir === 1) endTour();
}

function visible(): number[] {
  if (!tour) return [];
  return tour.steps.map((_, i) => i).filter((i) => available(tour!.steps[i]));
}

function draw(step: TourStep): void {
  if (!tour) return;
  const { root, hole, card, labels, index } = tour;
  const rect = step.target ? step.target() : null;
  root.classList.toggle('dim', !rect);
  hole.hidden = !rect;
  if (rect) {
    const room = step.bounds?.() ?? { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight };
    const edge = 6;
    const x0 = Math.max(room.x + edge, rect.x - PAD);
    const y0 = Math.max(room.y + edge, rect.y - PAD);
    const x1 = Math.min(room.x + room.w - edge, rect.x + rect.w + PAD);
    const y1 = Math.min(room.y + room.h - edge, rect.y + rect.h + PAD);
    hole.style.left = `${x0}px`;
    hole.style.top = `${y0}px`;
    hole.style.width = `${Math.max(0, x1 - x0)}px`;
    hole.style.height = `${Math.max(0, y1 - y0)}px`;
  }

  const order = visible();
  const position = order.indexOf(index) + 1;
  const last = position === order.length;
  const button = (cls: string, text: string, onClick: () => void) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.textContent = text;
    b.addEventListener('click', onClick);
    return b;
  };
  const count = document.createElement('p');
  count.className = 'tour-count';
  count.textContent = labels.count(position, order.length);
  const title = document.createElement('h3');
  title.textContent = step.title;
  const text = document.createElement('p');
  text.className = 'tour-text';
  text.textContent = step.text;
  const actions = document.createElement('div');
  actions.className = 'tour-actions';
  if (!last) actions.append(button('tour-skip', labels.skip, endTour));
  if (position > 1) actions.append(button('tour-btn', labels.prev, () => move(index - 1, -1)));
  const next = button('tour-btn primary', last ? labels.done : labels.next, () => move(index + 1, 1));
  actions.append(next);
  card.replaceChildren(count, title, text, actions);
  place(card, rect);
  next.focus({ focusVisible: false } as FocusOptions);
}

function place(card: HTMLElement, rect: TourRect | null): void {
  const W = window.innerWidth;
  const H = window.innerHeight;
  const cw = card.offsetWidth;
  const ch = card.offsetHeight;
  let x = (W - cw) / 2;
  let y = (H - ch) / 2;
  if (rect) {
    const below = rect.y + rect.h + PAD + GAP;
    const above = rect.y - PAD - GAP - ch;
    const right = rect.x + rect.w + PAD + GAP;
    const left = rect.x - PAD - GAP - cw;
    if (below + ch <= H - MARGIN) {
      y = below;
      x = rect.x;
    } else if (above >= MARGIN) {
      y = above;
      x = rect.x;
    } else if (right + cw <= W - MARGIN) {
      x = right;
      y = rect.y;
    } else if (left >= MARGIN) {
      x = left;
      y = rect.y;
    }
  }
  card.style.left = `${Math.round(Math.min(Math.max(MARGIN, x), W - cw - MARGIN))}px`;
  card.style.top = `${Math.round(Math.min(Math.max(MARGIN, y), H - ch - MARGIN))}px`;
}
