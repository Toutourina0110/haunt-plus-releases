import { CH } from '../shared/channels';
import type { CaptureInit, CaptureRect } from '../shared/types';
import { desk } from './common';

const shot = document.getElementById('shot') as HTMLImageElement;
const dim = document.getElementById('dim')!;
const sel = document.getElementById('sel')!;
const size = document.getElementById('size')!;
const hint = document.getElementById('hint')!;

let start: { x: number; y: number } | null = null;
let rect: CaptureRect = { x: 0, y: 0, w: 0, h: 0 };
let sent = false;

function finish(result: CaptureRect | null): void {
  if (sent) return;
  sent = true;
  desk.send(CH.captureSelect, result);
}

function draw(): void {
  sel.style.left = `${rect.x}px`;
  sel.style.top = `${rect.y}px`;
  sel.style.width = `${rect.w}px`;
  sel.style.height = `${rect.h}px`;
  const k = window.devicePixelRatio || 1;
  size.textContent = `${Math.round(rect.w * k)} × ${Math.round(rect.h * k)}`;
}

document.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  document.documentElement.setPointerCapture(event.pointerId);
  start = { x: event.clientX, y: event.clientY };
  rect = { x: start.x, y: start.y, w: 0, h: 0 };
  document.body.classList.add('drawing');
  dim.hidden = true;
  sel.hidden = false;
  draw();
});

document.addEventListener('pointermove', (event) => {
  if (!start) return;
  rect = {
    x: Math.min(start.x, event.clientX),
    y: Math.min(start.y, event.clientY),
    w: Math.abs(event.clientX - start.x),
    h: Math.abs(event.clientY - start.y),
  };
  draw();
});

document.addEventListener('pointerup', () => {
  if (!start) return;
  start = null;
  if (rect.w >= 4 && rect.h >= 4) return finish(rect);
  document.body.classList.remove('drawing');
  sel.hidden = true;
  dim.hidden = false;
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') finish(null);
  if (event.key === 'Enter') finish({ x: 0, y: 0, w: window.innerWidth, h: window.innerHeight });
});

document.addEventListener('contextmenu', (event) => {
  event.preventDefault();
  finish(null);
});

async function main(): Promise<void> {
  const init = await desk.invoke<CaptureInit>(CH.captureInit);
  hint.textContent = init.hint;
  shot.src = init.image;
}

void main();
