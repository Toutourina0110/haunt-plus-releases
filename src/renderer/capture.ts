import { CH } from '../shared/channels';
import type { CaptureInit, CaptureRect, PickAction } from '../shared/types';
import { applyFont, desk } from './common';
import { icon } from './hicons';

const shot = document.getElementById('shot') as HTMLImageElement;
const dim = document.getElementById('dim')!;
const sel = document.getElementById('sel')!;
const size = document.getElementById('size')!;
const hint = document.getElementById('hint')!;
const bar = document.getElementById('bar')!;

type Drag =
  | { mode: 'draw'; x: number; y: number }
  | { mode: 'move'; x: number; y: number; start: CaptureRect }
  | { mode: 'resize'; handle: string; start: CaptureRect };

let drag: Drag | null = null;
let rect: CaptureRect = { x: 0, y: 0, w: 0, h: 0 };
let chosen = false;
let sent = false;
let mode: CaptureInit['mode'] = 'shot';

const stroke = (body: string) =>
  `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const ICONS: Record<PickAction | 'cancel', string> = {
  annotate: icon('pen', 16),
  upload: icon('upload', 16),
  copy: icon('copy', 16),
  save: stroke('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  cancel: stroke('<path d="M6 6l12 12M18 6 6 18"/>'),
  record: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>',
};
const KEYS: Record<PickAction | 'cancel', string> = { annotate: 'A', upload: 'Enter', copy: 'Ctrl+C', save: 'Ctrl+S', record: 'Enter', cancel: 'Esc' };

function finish(action: PickAction | null, area = rect): void {
  if (sent) return;
  sent = true;
  desk.send(CH.captureSelect, action ? { rect: area, action } : null);
}

function draw(): void {
  sel.style.left = `${rect.x}px`;
  sel.style.top = `${rect.y}px`;
  sel.style.width = `${rect.w}px`;
  sel.style.height = `${rect.h}px`;
  const k = window.devicePixelRatio || 1;
  size.textContent = `${Math.round(rect.w * k)} × ${Math.round(rect.h * k)}`;
  if (chosen) placeBar();
}

function placeBar(): void {
  const gap = 8;
  const bw = bar.offsetWidth;
  const bh = bar.offsetHeight;
  let top = rect.y + rect.h + gap;
  if (top + bh > window.innerHeight - gap) top = rect.y - bh - gap;
  if (top < gap) top = rect.y + rect.h - bh - gap;
  const left = Math.min(window.innerWidth - bw - gap, Math.max(gap, rect.x + rect.w - bw));
  bar.style.left = `${left}px`;
  bar.style.top = `${Math.max(gap, top)}px`;
}

function choose(): void {
  chosen = true;
  document.body.classList.add('chosen');
  bar.hidden = false;
  draw();
}

function reset(): void {
  chosen = false;
  document.body.classList.remove('drawing', 'chosen');
  bar.hidden = true;
  sel.hidden = true;
  dim.hidden = false;
}

function inside(x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

function clampRect(r: CaptureRect): CaptureRect {
  const w = Math.min(r.w, window.innerWidth);
  const h = Math.min(r.h, window.innerHeight);
  return { x: Math.max(0, Math.min(window.innerWidth - w, r.x)), y: Math.max(0, Math.min(window.innerHeight - h, r.y)), w, h };
}

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || (event.target as Element).closest('#bar')) return;
  document.documentElement.setPointerCapture(event.pointerId);
  const handle = (event.target as HTMLElement).dataset.handle;
  if (chosen && handle) {
    drag = { mode: 'resize', handle, start: { ...rect } };
    return;
  }
  if (chosen && inside(event.clientX, event.clientY)) {
    drag = { mode: 'move', x: event.clientX, y: event.clientY, start: { ...rect } };
    return;
  }
  chosen = false;
  bar.hidden = true;
  document.body.classList.remove('chosen');
  drag = { mode: 'draw', x: event.clientX, y: event.clientY };
  rect = { x: event.clientX, y: event.clientY, w: 0, h: 0 };
  document.body.classList.add('drawing');
  dim.hidden = true;
  sel.hidden = false;
  draw();
});

document.addEventListener('pointermove', (event) => {
  if (!drag) return;
  const x = event.clientX;
  const y = event.clientY;
  if (drag.mode === 'draw') {
    rect = { x: Math.min(drag.x, x), y: Math.min(drag.y, y), w: Math.abs(x - drag.x), h: Math.abs(y - drag.y) };
  } else if (drag.mode === 'move') {
    rect = clampRect({ ...drag.start, x: drag.start.x + x - drag.x, y: drag.start.y + y - drag.y });
  } else {
    const s = drag.start;
    let x1 = s.x;
    let y1 = s.y;
    let x2 = s.x + s.w;
    let y2 = s.y + s.h;
    if (drag.handle.includes('w')) x1 = x;
    if (drag.handle.includes('e')) x2 = x;
    if (drag.handle.includes('n')) y1 = y;
    if (drag.handle.includes('s')) y2 = y;
    rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  draw();
});

document.addEventListener('pointerup', () => {
  if (!drag) return;
  drag = null;
  if (rect.w >= 4 && rect.h >= 4) return choose();
  reset();
});

document.addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape') return finish(null);
  if (event.key === 'Enter') {
    const main: PickAction = mode === 'video' ? 'record' : 'upload';
    return chosen ? finish(main) : finish(main, { x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
  }
  if (!chosen || mode === 'video') return;
  if (ctrl && event.key.toLowerCase() === 'c') finish('copy');
  else if (ctrl && event.key.toLowerCase() === 's') finish('save');
  else if (!ctrl && event.key.toLowerCase() === 'a') finish('annotate');
  else return;
  event.preventDefault();
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  finish(null);
});

function buildBar(labels: CaptureInit['labels']): void {
  const actions: Array<PickAction | 'cancel'> = mode === 'video' ? ['record', 'cancel'] : ['annotate', 'upload', 'copy', 'save', 'cancel'];
  for (const action of actions) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = action === 'upload' ? 'act primary' : action === 'record' ? 'act rec' : action === 'cancel' ? 'act icon' : 'act';
    b.title = `${labels[action]} (${KEYS[action]})`;
    b.setAttribute('aria-label', labels[action]);
    b.innerHTML = ICONS[action];
    if (action !== 'cancel') b.append(labels[action]);
    b.addEventListener('click', () => finish(action === 'cancel' ? null : action));
    bar.append(b);
  }
  for (const handle of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) {
    const el = document.createElement('span');
    el.className = `handle ${handle}`;
    el.dataset.handle = handle;
    sel.append(el);
  }
}

async function main(): Promise<void> {
  const init = await desk.invoke<CaptureInit>(CH.captureInit);
  hint.textContent = init.hint;
  mode = init.mode;
  buildBar(init.labels);
  applyFont(init.font);
  shot.src = init.image;
}

void main();
