import { CH } from '../shared/channels';
import type { CaptureDown, CaptureInit, CaptureRect, CaptureSync, PickAction } from '../shared/types';
import { applyFont, desk } from './common';
import { icon } from './hicons';

const shot = document.getElementById('shot') as HTMLImageElement;
const dim = document.getElementById('dim')!;
const sel = document.getElementById('sel')!;
const size = document.getElementById('size')!;
const hint = document.getElementById('hint')!;
const bar = document.getElementById('bar')!;

let origin = { x: 0, y: 0 };
let rect: CaptureRect | null = null;
let chosen = false;
let dragging = false;
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

function finish(action: PickAction | null, whole = false, all = false): void {
  if (sent) return;
  sent = true;
  desk.send(CH.captureSelect, action ? { action, whole, all } : null);
}

function draw(barHere: boolean): void {
  const seen = !!rect && rect.x < window.innerWidth && rect.x + rect.w > 0 && rect.y < window.innerHeight && rect.y + rect.h > 0;
  document.body.classList.toggle('drawing', dragging || (!!rect && !chosen));
  document.body.classList.toggle('chosen', chosen);
  sel.hidden = !seen;
  dim.hidden = seen;
  bar.hidden = !(chosen && barHere);
  if (!rect) return;
  sel.style.left = `${rect.x}px`;
  sel.style.top = `${rect.y}px`;
  sel.style.width = `${rect.w}px`;
  sel.style.height = `${rect.h}px`;
  const k = window.devicePixelRatio || 1;
  size.textContent = `${Math.round(rect.w * k)} × ${Math.round(rect.h * k)}`;
  if (!bar.hidden) placeBar(rect);
}

function placeBar(r: CaptureRect): void {
  const gap = 8;
  const bw = bar.offsetWidth;
  const bh = bar.offsetHeight;
  let top = r.y + r.h + gap;
  if (top + bh > window.innerHeight - gap) top = r.y - bh - gap;
  if (top < gap) top = Math.min(r.y + r.h, window.innerHeight) - bh - gap;
  const left = Math.min(window.innerWidth - bw - gap, Math.max(gap, Math.min(r.x + r.w, window.innerWidth) - bw));
  bar.style.left = `${left}px`;
  bar.style.top = `${Math.max(gap, top)}px`;
}

function inside(x: number, y: number): boolean {
  return !!rect && x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0 || (event.target as Element).closest('#bar')) return;
  if (mode === 'screen') return finish('upload', true);
  document.documentElement.setPointerCapture(event.pointerId);
  const handle = (event.target as HTMLElement).dataset.handle;
  let down: CaptureDown = { mode: 'draw' };
  if (chosen && handle) down = { mode: 'resize', handle };
  else if (chosen && inside(event.clientX, event.clientY)) down = { mode: 'move' };
  dragging = true;
  desk.send(CH.captureDown, down);
});

document.addEventListener('pointerup', () => {
  dragging = false;
  desk.send(CH.captureUp);
});

document.addEventListener('keydown', (event) => {
  const ctrl = event.ctrlKey || event.metaKey;
  if (event.key === 'Escape') return finish(null);
  if (mode === 'screen') {
    if (event.key === 'Enter') finish('upload', true);
    return;
  }
  if (event.key === 'Enter') {
    return finish(mode === 'video' ? 'record' : 'upload', !chosen);
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

function buildScreenBar(labels: CaptureInit['labels'], screens: NonNullable<CaptureInit['screens']>): void {
  const buttons: Array<[string, string, () => void]> = [
    ['act primary', screens.here, () => finish('upload', true)],
    ['act', screens.all, () => finish('upload', true, true)],
    ['act icon', labels.cancel, () => finish(null)],
  ];
  for (const [cls, label, run] of buttons) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = cls;
    b.setAttribute('aria-label', label);
    if (cls === 'act icon') b.innerHTML = ICONS.cancel;
    else b.textContent = label;
    b.addEventListener('click', run);
    bar.append(b);
  }
  document.body.classList.add('screen-mode');
  bar.hidden = false;
}

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
  origin = init.origin;
  if (mode === 'screen' && init.screens) buildScreenBar(init.labels, init.screens);
  else buildBar(init.labels);
  applyFont(init.font);
  shot.src = init.image;
}

desk.on<CaptureSync>(CH.captureSync, (state) => {
  if (sent || mode === 'screen') return;
  rect = state.rect && { ...state.rect, x: state.rect.x - origin.x, y: state.rect.y - origin.y };
  chosen = state.chosen;
  draw(state.bar);
});

void main();
