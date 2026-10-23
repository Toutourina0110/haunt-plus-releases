import { CH } from '../shared/channels';
import { IMAGE_ERRORS, type StringKey } from '../shared/i18n';
import type { AnnotateAction, AnnotateInit, AnnotateResult } from '../shared/types';
import { applyFont, desk, LOGOS, setLocale, tr } from './common';
import { icon } from './hicons';

type Tool = 'select' | 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'step' | 'pen' | 'highlight' | 'blur' | 'pixel' | 'crop';
type BoxKind = 'rect' | 'ellipse' | 'blur' | 'pixel';

interface Box {
  kind: BoxKind;
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  width: number;
  fill: boolean;
  strength: number;
}
interface Segment {
  kind: 'line' | 'arrow';
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  width: number;
}
interface Stroke {
  kind: 'pen' | 'highlight';
  points: number[];
  color: string;
  width: number;
}
interface Label {
  kind: 'text';
  x: number;
  y: number;
  text: string;
  size: number;
  color: string;
}
interface Step {
  kind: 'step';
  x: number;
  y: number;
  n: number;
  size: number;
  color: string;
}
type Shape = Box | Segment | Stroke | Label | Step;
interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
interface Snapshot {
  image: HTMLImageElement | null;
  crop: Rect;
  shapes: Shape[];
}

const COLORS = ['#ff3b5c', '#ff9f1c', '#ffd60a', '#2ec27e', '#3a86ff', '#8079c9', '#ffffff', '#111111', '#808080'];
const TOOLS: Array<{ id: Tool; key: string; label: StringKey; svg: string } | null> = [
  { id: 'select', key: 'v', label: 'annSelect', svg: '<path d="M6 3l12 9-6 1.2L9 19z"/>' },
  null,
  { id: 'rect', key: 'r', label: 'annRect', svg: '<rect x="4" y="6" width="16" height="12" rx="2"/>' },
  { id: 'ellipse', key: 'e', label: 'annEllipse', svg: '<ellipse cx="12" cy="12" rx="8.5" ry="6.5"/>' },
  { id: 'line', key: 'l', label: 'annLine', svg: '<path d="M5 19 19 5"/>' },
  { id: 'arrow', key: 'a', label: 'annArrow', svg: '<path d="M5 19 19 5M10 5h9v9"/>' },
  null,
  { id: 'text', key: 't', label: 'annText', svg: '<path d="M5 7V5h14v2M12 5v14M9 19h6"/>' },
  { id: 'step', key: 'n', label: 'annStep', svg: '<circle cx="12" cy="12" r="8.5"/><path d="M10.5 9.5 12.5 8v8"/>' },
  { id: 'pen', key: 'p', label: 'annPen', svg: '<path d="M4 20l1-4L16 5l3 3L8 19z"/>' },
  { id: 'highlight', key: 'h', label: 'annHighlight', svg: '<path d="M15 4l5 5-8 8H8v-4zM4 20h9"/>' },
  null,
  { id: 'blur', key: 'b', label: 'annBlur', svg: '<path d="M12 3c3.5 4.2 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 2.5-6.8 6-11z"/>' },
  {
    id: 'pixel',
    key: 'x',
    label: 'annPixel',
    svg: '<path d="M4 4h6v6H4zM14 14h6v6h-6z" fill="currentColor" stroke="none"/><path d="M14 4h6v6h-6zM4 14h6v6H4z"/>',
  },
  { id: 'crop', key: 'c', label: 'annCrop', svg: '<path d="M6 2v16h16M2 6h16v16"/>' },
];
const stroke = (body: string, size = 20) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const UNDO = '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>';
const REDO = '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>';
const SAVE = '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>';
const FIT = '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>';
const MINUS = '<path d="M5 12h14"/>';
const PLUS = '<path d="M5 12h14M12 5v14"/>';
const TRASH = '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>';

let image: HTMLImageElement | null = null;
let crop: Rect = { x: 0, y: 0, w: 0, h: 0 };
let shapes: Shape[] = [];
let selected: Shape | null = null;
let draft: Shape | null = null;
let cropDraft: Rect | null = null;
let editing: Label | null = null;
let tool: Tool = 'arrow';
const style = { color: COLORS[0], width: 4, fill: false, textSize: 32, strength: 14 };
let history: Snapshot[] = [];
let at = -1;
let hasKey = false;
let busy = false;

const view = { scale: 1, ox: 0, oy: 0, fit: true };

const stage = document.getElementById('stage') as HTMLElement;
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const textEdit = document.getElementById('text-edit') as HTMLTextAreaElement;
const empty = document.getElementById('empty') as HTMLElement;
const props = document.getElementById('props') as HTMLElement;
const toastEl = document.getElementById('toast') as HTMLElement;
let toastTimer = 0;

const base = document.createElement('canvas');
const scene = document.createElement('canvas');
let baseDirty = true;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string | null>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

function iconBtn(cls: string, label: string, svg: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, title: label, 'aria-label': label });
  b.innerHTML = svg;
  b.addEventListener('click', onClick);
  return b;
}

function textBtn(cls: string, label: string, svg: string, onClick: () => void): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls });
  b.innerHTML = svg;
  b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

function toast(text: string, bad = false): void {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3200);
}

function norm(r: Rect): Rect {
  return { x: Math.min(r.x, r.x + r.w), y: Math.min(r.y, r.y + r.h), w: Math.abs(r.w), h: Math.abs(r.h) };
}

function isBox(s: Shape): s is Box {
  return s.kind === 'rect' || s.kind === 'ellipse' || s.kind === 'blur' || s.kind === 'pixel';
}

function isEffect(s: Shape): s is Box {
  return s.kind === 'blur' || s.kind === 'pixel';
}

function fontFamily(): string {
  return getComputedStyle(document.body).fontFamily || 'sans-serif';
}

function textFont(size: number): string {
  return `600 ${size}px ${fontFamily()}`;
}

function textLines(s: Label): string[] {
  return s.text.split('\n');
}

function bounds(s: Shape): Rect {
  switch (s.kind) {
    case 'rect':
    case 'ellipse':
    case 'blur':
    case 'pixel':
      return norm(s);
    case 'line':
    case 'arrow': {
      const pad = s.width;
      return { x: Math.min(s.x1, s.x2) - pad, y: Math.min(s.y1, s.y2) - pad, w: Math.abs(s.x2 - s.x1) + pad * 2, h: Math.abs(s.y2 - s.y1) + pad * 2 };
    }
    case 'pen':
    case 'highlight': {
      const xs = s.points.filter((_, i) => i % 2 === 0);
      const ys = s.points.filter((_, i) => i % 2 === 1);
      const pad = strokeWidth(s) / 2;
      const x = Math.min(...xs) - pad;
      const y = Math.min(...ys) - pad;
      return { x, y, w: Math.max(...xs) + pad - x, h: Math.max(...ys) + pad - y };
    }
    case 'text': {
      ctx.save();
      ctx.font = textFont(s.size);
      const w = Math.max(s.size * 0.5, ...textLines(s).map((l) => ctx.measureText(l).width));
      ctx.restore();
      return { x: s.x, y: s.y, w, h: textLines(s).length * s.size * 1.2 };
    }
    case 'step': {
      const r = s.size / 2;
      return { x: s.x - r, y: s.y - r, w: r * 2, h: r * 2 };
    }
  }
}

function strokeWidth(s: Stroke): number {
  return s.kind === 'highlight' ? s.width * 4 : s.width;
}

function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / len)) : 0;
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function hit(s: Shape, x: number, y: number, tol: number): boolean {
  switch (s.kind) {
    case 'line':
    case 'arrow':
      return distToSegment(x, y, s.x1, s.y1, s.x2, s.y2) <= tol + s.width / 2;
    case 'pen':
    case 'highlight': {
      const p = s.points;
      if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= tol + strokeWidth(s) / 2;
      for (let i = 2; i < p.length; i += 2) {
        if (distToSegment(x, y, p[i - 2], p[i - 1], p[i], p[i + 1]) <= tol + strokeWidth(s) / 2) return true;
      }
      return false;
    }
    case 'ellipse': {
      const b = norm(s);
      const rx = b.w / 2 + tol;
      const ry = b.h / 2 + tol;
      return ((x - b.x - b.w / 2) / rx) ** 2 + ((y - b.y - b.h / 2) / ry) ** 2 <= 1;
    }
    default: {
      const b = bounds(s);
      return x >= b.x - tol && x <= b.x + b.w + tol && y >= b.y - tol && y <= b.y + b.h + tol;
    }
  }
}

function contrast(color: string): string {
  const m = /^#([0-9a-f]{6})$/i.exec(color);
  if (!m) return '#ffffff';
  const n = parseInt(m[1], 16);
  const lum = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return lum > 0.6 ? '#111111' : '#ffffff';
}

function drawEffect(c: CanvasRenderingContext2D, s: Box): void {
  if (!image) return;
  const r = norm(s);
  const x = Math.max(0, Math.floor(r.x));
  const y = Math.max(0, Math.floor(r.y));
  const w = Math.min(image.naturalWidth, Math.ceil(r.x + r.w)) - x;
  const h = Math.min(image.naturalHeight, Math.ceil(r.y + r.h)) - y;
  if (w < 1 || h < 1) return;
  c.save();
  c.beginPath();
  c.rect(x, y, w, h);
  c.clip();
  if (s.kind === 'blur') {
    c.filter = `blur(${s.strength}px)`;
    const m = s.strength * 3;
    c.drawImage(image, x - m, y - m, w + m * 2, h + m * 2, x - m, y - m, w + m * 2, h + m * 2);
  } else {
    const cell = Math.max(2, s.strength);
    const tw = Math.max(1, Math.ceil(w / cell));
    const th = Math.max(1, Math.ceil(h / cell));
    const tmp = document.createElement('canvas');
    tmp.width = tw;
    tmp.height = th;
    tmp.getContext('2d')!.drawImage(image, x, y, w, h, 0, 0, tw, th);
    c.imageSmoothingEnabled = false;
    c.drawImage(tmp, 0, 0, tw, th, x, y, tw * cell, th * cell);
  }
  c.restore();
}

function drawArrowHead(c: CanvasRenderingContext2D, s: Segment): void {
  const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
  const len = Math.max(12, s.width * 3.6);
  const spread = Math.PI / 7;
  c.beginPath();
  c.moveTo(s.x2, s.y2);
  c.lineTo(s.x2 - len * Math.cos(angle - spread), s.y2 - len * Math.sin(angle - spread));
  c.lineTo(s.x2 - len * Math.cos(angle + spread), s.y2 - len * Math.sin(angle + spread));
  c.closePath();
  c.fill();
}

function drawShape(c: CanvasRenderingContext2D, s: Shape): void {
  c.save();
  c.lineCap = 'round';
  c.lineJoin = 'round';
  switch (s.kind) {
    case 'rect':
    case 'ellipse': {
      const r = norm(s);
      c.beginPath();
      if (s.kind === 'rect') c.roundRect(r.x, r.y, r.w, r.h, Math.min(6, r.w / 2, r.h / 2));
      else c.ellipse(r.x + r.w / 2, r.y + r.h / 2, r.w / 2, r.h / 2, 0, 0, Math.PI * 2);
      if (s.fill) {
        c.fillStyle = s.color;
        c.fill();
      } else {
        c.strokeStyle = s.color;
        c.lineWidth = s.width;
        c.stroke();
      }
      break;
    }
    case 'line':
    case 'arrow': {
      c.strokeStyle = s.color;
      c.fillStyle = s.color;
      c.lineWidth = s.width;
      let ex = s.x2;
      let ey = s.y2;
      if (s.kind === 'arrow') {
        const angle = Math.atan2(s.y2 - s.y1, s.x2 - s.x1);
        const back = Math.max(12, s.width * 3.6) * 0.6;
        ex -= back * Math.cos(angle);
        ey -= back * Math.sin(angle);
      }
      c.beginPath();
      c.moveTo(s.x1, s.y1);
      c.lineTo(ex, ey);
      c.stroke();
      if (s.kind === 'arrow') drawArrowHead(c, s);
      break;
    }
    case 'pen':
    case 'highlight': {
      const p = s.points;
      c.strokeStyle = s.color;
      c.lineWidth = strokeWidth(s);
      if (s.kind === 'highlight') {
        c.globalAlpha = 0.45;
        c.globalCompositeOperation = 'multiply';
      }
      c.beginPath();
      c.moveTo(p[0], p[1]);
      if (p.length === 2) c.lineTo(p[0] + 0.01, p[1]);
      for (let i = 2; i < p.length - 2; i += 2) {
        c.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
      }
      if (p.length > 2) c.lineTo(p[p.length - 2], p[p.length - 1]);
      c.stroke();
      break;
    }
    case 'text': {
      if (s === editing) break;
      c.font = textFont(s.size);
      c.textBaseline = 'top';
      c.lineWidth = Math.max(2, s.size / 7);
      c.strokeStyle = contrast(s.color);
      c.fillStyle = s.color;
      textLines(s).forEach((line, i) => {
        const y = s.y + i * s.size * 1.2;
        c.strokeText(line, s.x, y);
        c.fillText(line, s.x, y);
      });
      break;
    }
    case 'step': {
      const r = s.size / 2;
      c.beginPath();
      c.arc(s.x, s.y, r, 0, Math.PI * 2);
      c.fillStyle = s.color;
      c.fill();
      c.lineWidth = Math.max(2, r / 8);
      c.strokeStyle = contrast(s.color) === '#ffffff' ? 'rgb(255 255 255 / 0.9)' : 'rgb(0 0 0 / 0.6)';
      c.stroke();
      c.fillStyle = contrast(s.color);
      c.font = textFont(Math.round(r * 1.1));
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(s.n), s.x, s.y + r * 0.04);
      break;
    }
    default:
      break;
  }
  c.restore();
}

function renderScene(): void {
  if (!image) return;
  const w = image.naturalWidth;
  const h = image.naturalHeight;
  if (baseDirty) {
    base.width = w;
    base.height = h;
    const b = base.getContext('2d')!;
    b.drawImage(image, 0, 0);
    for (const s of shapes) if (isEffect(s)) drawEffect(b, s);
    if (draft && isEffect(draft)) drawEffect(b, draft);
    baseDirty = false;
  }
  if (scene.width !== w || scene.height !== h) {
    scene.width = w;
    scene.height = h;
  }
  const c = scene.getContext('2d')!;
  c.clearRect(0, 0, w, h);
  c.drawImage(base, 0, 0);
  for (const s of shapes) if (!isEffect(s)) drawShape(c, s);
  if (draft && !isEffect(draft)) drawShape(c, draft);
}

let frame = 0;
let sceneWanted = false;
function render(withScene = true): void {
  sceneWanted ||= withScene;
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    const redraw = sceneWanted;
    sceneWanted = false;
    draw(redraw);
  });
}

function draw(withScene: boolean): void {
  const dpr = window.devicePixelRatio || 1;
  const cw = stage.clientWidth;
  const ch = stage.clientHeight;
  if (canvas.width !== Math.round(cw * dpr) || canvas.height !== Math.round(ch * dpr)) {
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  empty.hidden = !!image;
  if (!image) return;
  if (view.fit) fitView();
  if (withScene) renderScene();
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const s = view.scale;
  const dx = crop.x * s + view.ox;
  const dy = crop.y * s + view.oy;
  ctx.imageSmoothingQuality = 'high';
  ctx.imageSmoothingEnabled = s < 2;
  ctx.drawImage(scene, crop.x, crop.y, crop.w, crop.h, dx, dy, crop.w * s, crop.h * s);
  ctx.strokeStyle = 'rgb(128 128 128 / 0.35)';
  ctx.lineWidth = 1;
  ctx.strokeRect(dx - 0.5, dy - 0.5, crop.w * s + 1, crop.h * s + 1);

  if (cropDraft) {
    const r = norm(cropDraft);
    ctx.fillStyle = 'rgb(0 0 0 / 0.55)';
    ctx.beginPath();
    ctx.rect(dx, dy, crop.w * s, crop.h * s);
    ctx.rect(r.x * s + view.ox, r.y * s + view.oy, r.w * s, r.h * s);
    ctx.fill('evenodd');
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(r.x * s + view.ox, r.y * s + view.oy, r.w * s, r.h * s);
    ctx.setLineDash([]);
  }
  if (selected && tool === 'select') drawSelection(selected);
  if (editing) placeText();
}

const HANDLE = 8;

function handles(s: Shape): Array<{ id: string; x: number; y: number; cursor: string }> {
  if (s.kind === 'line' || s.kind === 'arrow') {
    return [
      { id: 'p1', x: s.x1, y: s.y1, cursor: 'move' },
      { id: 'p2', x: s.x2, y: s.y2, cursor: 'move' },
    ];
  }
  if (!isBox(s)) return [];
  const r = norm(s);
  const xs = [r.x, r.x + r.w / 2, r.x + r.w];
  const ys = [r.y, r.y + r.h / 2, r.y + r.h];
  return [
    { id: 'nw', x: xs[0], y: ys[0], cursor: 'nwse' },
    { id: 'n', x: xs[1], y: ys[0], cursor: 'ns' },
    { id: 'ne', x: xs[2], y: ys[0], cursor: 'nesw' },
    { id: 'e', x: xs[2], y: ys[1], cursor: 'ew' },
    { id: 'se', x: xs[2], y: ys[2], cursor: 'nwse' },
    { id: 's', x: xs[1], y: ys[2], cursor: 'ns' },
    { id: 'sw', x: xs[0], y: ys[2], cursor: 'nesw' },
    { id: 'w', x: xs[0], y: ys[1], cursor: 'ew' },
  ];
}

function drawSelection(s: Shape): void {
  const b = bounds(s);
  const sc = view.scale;
  ctx.save();
  ctx.setLineDash([5, 4]);
  ctx.strokeStyle = '#8079c9';
  ctx.lineWidth = 1.5;
  if (s.kind !== 'line' && s.kind !== 'arrow') ctx.strokeRect(b.x * sc + view.ox - 3, b.y * sc + view.oy - 3, b.w * sc + 6, b.h * sc + 6);
  ctx.setLineDash([]);
  for (const hd of handles(s)) {
    const x = hd.x * sc + view.ox;
    const y = hd.y * sc + view.oy;
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#8079c9';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.rect(x - HANDLE / 2, y - HANDLE / 2, HANDLE, HANDLE);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

function fitView(): void {
  if (!image) return;
  const pad = 32;
  const cw = Math.max(1, stage.clientWidth - pad * 2);
  const ch = Math.max(1, stage.clientHeight - pad * 2);
  view.scale = Math.min(1, cw / crop.w, ch / crop.h);
  view.ox = (stage.clientWidth - crop.w * view.scale) / 2 - crop.x * view.scale;
  view.oy = (stage.clientHeight - crop.h * view.scale) / 2 - crop.y * view.scale;
  updateZoomLabel();
}

function zoomAt(factor: number, sx = stage.clientWidth / 2, sy = stage.clientHeight / 2): void {
  const next = Math.min(16, Math.max(0.05, view.scale * factor));
  const ix = (sx - view.ox) / view.scale;
  const iy = (sy - view.oy) / view.scale;
  view.scale = next;
  view.ox = sx - ix * next;
  view.oy = sy - iy * next;
  view.fit = false;
  updateZoomLabel();
  render(false);
}

let zoomLabel: HTMLElement | null = null;
function updateZoomLabel(): void {
  if (zoomLabel) zoomLabel.textContent = `${Math.round(view.scale * 100)} %`;
}

function toImage(e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = canvas.getBoundingClientRect();
  return { x: (e.clientX - r.left - view.ox) / view.scale, y: (e.clientY - r.top - view.oy) / view.scale };
}

function snapshot(): Snapshot {
  return { image, crop: { ...crop }, shapes: structuredClone(shapes) };
}

function commit(): void {
  history = history.slice(0, at + 1);
  history.push(snapshot());
  if (history.length > 200) history.shift();
  at = history.length - 1;
  updateHistoryButtons();
}

function restore(i: number): void {
  const snap = history[i];
  if (!snap) return;
  at = i;
  const imageChanged = snap.image !== image || snap.crop.w !== crop.w || snap.crop.h !== crop.h;
  image = snap.image;
  crop = { ...snap.crop };
  shapes = structuredClone(snap.shapes);
  selected = null;
  baseDirty = true;
  if (imageChanged) view.fit = true;
  updateHistoryButtons();
  renderProps();
  render();
}

let undoBtn: HTMLButtonElement | null = null;
let redoBtn: HTMLButtonElement | null = null;
function updateHistoryButtons(): void {
  if (undoBtn) undoBtn.disabled = at <= 0;
  if (redoBtn) redoBtn.disabled = at >= history.length - 1;
}

type Drag =
  | { mode: 'pan'; sx: number; sy: number; ox: number; oy: number }
  | { mode: 'move'; last: { x: number; y: number }; moved: boolean }
  | { mode: 'resize'; handle: string; start: Shape }
  | { mode: 'draw'; start: { x: number; y: number } }
  | { mode: 'crop'; start: { x: number; y: number } };
let drag: Drag | null = null;
let spaceDown = false;

function handleAt(s: Shape, e: PointerEvent): string | null {
  const r = canvas.getBoundingClientRect();
  for (const hd of handles(s)) {
    const x = hd.x * view.scale + view.ox + r.left;
    const y = hd.y * view.scale + view.oy + r.top;
    if (Math.abs(e.clientX - x) <= HANDLE && Math.abs(e.clientY - y) <= HANDLE) return hd.id;
  }
  return null;
}

function shapeAt(x: number, y: number): Shape | null {
  const tol = 6 / view.scale;
  for (let i = shapes.length - 1; i >= 0; i--) if (hit(shapes[i], x, y, tol)) return shapes[i];
  return null;
}

function moveShape(s: Shape, dx: number, dy: number): void {
  switch (s.kind) {
    case 'line':
    case 'arrow':
      s.x1 += dx;
      s.y1 += dy;
      s.x2 += dx;
      s.y2 += dy;
      break;
    case 'pen':
    case 'highlight':
      for (let i = 0; i < s.points.length; i += 2) {
        s.points[i] += dx;
        s.points[i + 1] += dy;
      }
      break;
    default:
      s.x += dx;
      s.y += dy;
  }
}

function resizeShape(s: Shape, start: Shape, handle: string, p: { x: number; y: number }): void {
  if ((s.kind === 'line' || s.kind === 'arrow') && (start.kind === 'line' || start.kind === 'arrow')) {
    if (handle === 'p1') {
      s.x1 = p.x;
      s.y1 = p.y;
    } else {
      s.x2 = p.x;
      s.y2 = p.y;
    }
    return;
  }
  if (!isBox(s) || !isBox(start)) return;
  const r = norm(start);
  let x1 = r.x;
  let y1 = r.y;
  let x2 = r.x + r.w;
  let y2 = r.y + r.h;
  if (handle.includes('w')) x1 = p.x;
  if (handle.includes('e')) x2 = p.x;
  if (handle.includes('n')) y1 = p.y;
  if (handle.includes('s')) y2 = p.y;
  Object.assign(s, norm({ x: x1, y: y1, w: x2 - x1, h: y2 - y1 }));
}

function constrain(start: { x: number; y: number }, p: { x: number; y: number }, line: boolean, shift: boolean) {
  if (!shift) return p;
  const dx = p.x - start.x;
  const dy = p.y - start.y;
  if (line) {
    const angle = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
    const len = Math.hypot(dx, dy);
    return { x: start.x + len * Math.cos(angle), y: start.y + len * Math.sin(angle) };
  }
  const m = Math.max(Math.abs(dx), Math.abs(dy));
  return { x: start.x + m * Math.sign(dx || 1), y: start.y + m * Math.sign(dy || 1) };
}

function nextStep(): number {
  return shapes.reduce((n, s) => (s.kind === 'step' ? Math.max(n, s.n) : n), 0) + 1;
}

canvas.addEventListener('pointerdown', (e) => {
  if (!image || busy) return;
  if (editing) finishText();
  canvas.setPointerCapture(e.pointerId);
  if (e.button === 1 || (e.button === 0 && spaceDown)) {
    drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, ox: view.ox, oy: view.oy };
    stage.dataset.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  const p = toImage(e);

  if (tool === 'select') {
    const handle = selected ? handleAt(selected, e) : null;
    if (selected && handle) {
      drag = { mode: 'resize', handle, start: structuredClone(selected) };
      return;
    }
    selected = shapeAt(p.x, p.y);
    drag = selected ? { mode: 'move', last: p, moved: false } : null;
    renderProps();
    render(false);
    return;
  }
  if (tool === 'text') {
    const existing = shapeAt(p.x, p.y);
    startText(existing?.kind === 'text' ? existing : null, p);
    return;
  }
  if (tool === 'step') {
    const s: Step = { kind: 'step', x: p.x, y: p.y, n: nextStep(), size: Math.max(28, style.textSize * 1.1), color: style.color };
    shapes.push(s);
    selected = s;
    commit();
    renderProps();
    render();
    return;
  }
  if (tool === 'crop') {
    cropDraft = { x: p.x, y: p.y, w: 0, h: 0 };
    drag = { mode: 'crop', start: p };
    return;
  }
  const { color, width, fill, strength } = style;
  if (tool === 'line' || tool === 'arrow') draft = { kind: tool, x1: p.x, y1: p.y, x2: p.x, y2: p.y, color, width };
  else if (tool === 'pen' || tool === 'highlight') draft = { kind: tool, points: [p.x, p.y], color, width };
  else draft = { kind: tool, x: p.x, y: p.y, w: 0, h: 0, color, width, fill, strength };
  drag = { mode: 'draw', start: p };
});

canvas.addEventListener('pointermove', (e) => {
  if (!drag) {
    updateCursor(e);
    return;
  }
  if (drag.mode === 'pan') {
    view.ox = drag.ox + (e.clientX - drag.sx);
    view.oy = drag.oy + (e.clientY - drag.sy);
    view.fit = false;
    render(false);
    return;
  }
  const p = toImage(e);
  if (drag.mode === 'move' && selected) {
    moveShape(selected, p.x - drag.last.x, p.y - drag.last.y);
    drag.last = p;
    drag.moved = true;
    if (isEffect(selected)) baseDirty = true;
    render();
    return;
  }
  if (drag.mode === 'resize' && selected) {
    resizeShape(selected, drag.start, drag.handle, p);
    if (isEffect(selected)) baseDirty = true;
    render();
    return;
  }
  if (drag.mode === 'crop' && cropDraft) {
    const q = constrain(drag.start, p, false, e.shiftKey);
    cropDraft.w = q.x - drag.start.x;
    cropDraft.h = q.y - drag.start.y;
    render(false);
    return;
  }
  if (drag.mode === 'draw' && draft) {
    if (draft.kind === 'pen' || draft.kind === 'highlight') {
      const last = draft.points.length;
      const minStep = 1.5 / view.scale;
      if (Math.hypot(p.x - draft.points[last - 2], p.y - draft.points[last - 1]) >= minStep) draft.points.push(p.x, p.y);
    } else if (draft.kind === 'line' || draft.kind === 'arrow') {
      const q = constrain(drag.start, p, true, e.shiftKey);
      draft.x2 = q.x;
      draft.y2 = q.y;
    } else if (isBox(draft)) {
      const q = constrain(drag.start, p, false, e.shiftKey);
      draft.w = q.x - drag.start.x;
      draft.h = q.y - drag.start.y;
      if (isEffect(draft)) baseDirty = true;
    }
    render();
  }
});

function endDrag(): void {
  if (!drag) return;
  const d = drag;
  drag = null;
  if (d.mode === 'pan') {
    stage.dataset.cursor = spaceDown ? 'grab' : cursorFor(tool);
    return;
  }
  if (d.mode === 'move') {
    if (d.moved) commit();
    return;
  }
  if (d.mode === 'resize') {
    commit();
    return;
  }
  if (d.mode === 'crop' && cropDraft && image) {
    const r = norm(cropDraft);
    cropDraft = null;
    const x = Math.max(crop.x, Math.round(r.x));
    const y = Math.max(crop.y, Math.round(r.y));
    const w = Math.min(crop.x + crop.w, Math.round(r.x + r.w)) - x;
    const h = Math.min(crop.y + crop.h, Math.round(r.y + r.h)) - y;
    if (w >= 4 && h >= 4) {
      crop = { x, y, w, h };
      view.fit = true;
      commit();
    }
    render(false);
    return;
  }
  if (d.mode === 'draw' && draft) {
    const s = draft;
    draft = null;
    const b = bounds(s);
    const tiny = s.kind === 'pen' || s.kind === 'highlight' ? false : b.w * view.scale < 3 && b.h * view.scale < 3;
    if (!tiny) {
      if (isBox(s)) Object.assign(s, norm(s));
      shapes.push(s);
      selected = s;
      commit();
      renderProps();
    }
    if (isEffect(s)) baseDirty = true;
    render();
  }
}

canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('dblclick', (e) => {
  if (tool !== 'select' || !image) return;
  const p = toImage(e);
  const s = shapeAt(p.x, p.y);
  if (s?.kind === 'text') startText(s);
});
canvas.addEventListener('pointercancel', endDrag);

function cursorFor(t: Tool): string {
  if (t === 'select') return '';
  if (t === 'text') return 'text';
  return 'draw';
}

function updateCursor(e: PointerEvent): void {
  if (spaceDown) {
    stage.dataset.cursor = 'grab';
    return;
  }
  if (tool !== 'select' || !image) {
    stage.dataset.cursor = cursorFor(tool);
    return;
  }
  const handle = selected ? handleAt(selected, e) : null;
  if (handle && selected) {
    stage.dataset.cursor = handles(selected).find((hd) => hd.id === handle)?.cursor ?? '';
    return;
  }
  const p = toImage(e);
  stage.dataset.cursor = shapeAt(p.x, p.y) ? 'move' : '';
}

stage.addEventListener(
  'wheel',
  (e) => {
    if (!image) return;
    e.preventDefault();
    if (e.ctrlKey) {
      const r = canvas.getBoundingClientRect();
      zoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
      return;
    }
    view.ox -= e.shiftKey ? e.deltaY : e.deltaX;
    view.oy -= e.shiftKey ? 0 : e.deltaY;
    view.fit = false;
    render(false);
  },
  { passive: false },
);

function startText(existing: Label | null, at_?: { x: number; y: number }): void {
  const s: Label = existing ?? { kind: 'text', x: at_?.x ?? 0, y: at_?.y ?? 0, text: '', size: style.textSize, color: style.color };
  if (!existing) shapes.push(s);
  editing = s;
  selected = s;
  textEdit.value = s.text;
  textEdit.hidden = false;
  placeText();
  render();
  requestAnimationFrame(() => {
    textEdit.focus();
    textEdit.select();
  });
}

function placeText(): void {
  if (!editing) return;
  const s = editing;
  const size = s.size * view.scale;
  textEdit.style.left = `${s.x * view.scale + view.ox}px`;
  textEdit.style.top = `${s.y * view.scale + view.oy}px`;
  textEdit.style.font = textFont(size);
  textEdit.style.lineHeight = `${size * 1.2}px`;
  textEdit.style.color = s.color;
  const lines = textEdit.value.split('\n');
  textEdit.style.width = `${Math.max(size, ...lines.map((l) => measure(l, size))) + size * 0.6}px`;
  textEdit.style.height = `${lines.length * size * 1.2 + 4}px`;
}

function measure(text: string, size: number): number {
  ctx.save();
  ctx.font = textFont(size);
  const w = ctx.measureText(text).width;
  ctx.restore();
  return w;
}

function finishText(cancel = false): void {
  if (!editing) return;
  const s = editing;
  editing = null;
  textEdit.hidden = true;
  const value = cancel ? s.text : textEdit.value.replace(/\s+$/, '');
  if (!value) {
    shapes = shapes.filter((x) => x !== s);
    selected = null;
  } else if (value !== s.text) {
    s.text = value;
    commit();
  }
  renderProps();
  render();
}

textEdit.addEventListener('input', placeText);
textEdit.addEventListener('blur', () => finishText());
textEdit.addEventListener('keydown', (e) => {
  e.stopPropagation();
  if (e.key === 'Escape') finishText(true);
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) finishText();
});

function setTool(next: Tool): void {
  if (editing) finishText();
  tool = next;
  if (tool !== 'select') selected = null;
  cropDraft = null;
  for (const b of document.querySelectorAll<HTMLButtonElement>('.tool')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
  stage.dataset.cursor = cursorFor(tool);
  renderProps();
  render(false);
}

function buildTools(): void {
  const bar = document.getElementById('tools') as HTMLElement;
  for (const t of TOOLS) {
    if (!t) {
      bar.append(h('hr'));
      continue;
    }
    const label = `${tr(t.label)} (${t.key.toUpperCase()})`;
    const b = iconBtn('tool', label, stroke(t.svg), () => setTool(t.id));
    b.dataset.tool = t.id;
    b.setAttribute('aria-pressed', String(t.id === tool));
    bar.append(b);
  }
}

function needs(kind: Tool | Shape['kind']) {
  return {
    color: !['select', 'blur', 'pixel', 'crop'].includes(kind),
    width: ['rect', 'ellipse', 'line', 'arrow', 'pen', 'highlight'].includes(kind),
    fill: kind === 'rect' || kind === 'ellipse',
    size: kind === 'text' || kind === 'step',
    strength: kind === 'blur' || kind === 'pixel',
  };
}

function applyStyle(patch: Partial<typeof style>, done: boolean): void {
  Object.assign(style, patch);
  const s = selected;
  if (s) {
    if (patch.color !== undefined && 'color' in s) s.color = patch.color;
    if (patch.width !== undefined && 'width' in s) s.width = patch.width;
    if (patch.fill !== undefined && isBox(s)) s.fill = patch.fill;
    if (patch.strength !== undefined && isBox(s)) {
      s.strength = patch.strength;
      baseDirty = true;
    }
    if (patch.textSize !== undefined && (s.kind === 'text' || s.kind === 'step')) s.size = s.kind === 'step' ? Math.max(28, patch.textSize * 1.1) : patch.textSize;
    if (done) commit();
  }
  render();
}

function slider(label: StringKey, min: number, max: number, value: number, onInput: (v: number, done: boolean) => void): HTMLElement {
  const out = h('span', {}, String(value));
  const input = h('input', { type: 'range', min: String(min), max: String(max), value: String(value), 'aria-label': tr(label) });
  input.addEventListener('input', () => {
    out.textContent = input.value;
    onInput(Number(input.value), false);
  });
  input.addEventListener('change', () => onInput(Number(input.value), true));
  return h('div', { class: 'prop' }, h('div', { class: 'prop-label' }, h('span', {}, tr(label)), out), input);
}

function renderProps(): void {
  const kind = tool === 'select' && selected ? selected.kind : tool;
  const n = needs(kind);
  const current = selected && tool === 'select' ? selected : null;
  props.replaceChildren();

  if (n.color) {
    const color = current && 'color' in current ? current.color : style.color;
    const grid = h('div', { class: 'swatches' });
    for (const c of COLORS) {
      const b = h('button', { type: 'button', class: 'swatch', title: c, 'aria-label': c, 'aria-pressed': String(c.toLowerCase() === color.toLowerCase()) });
      b.style.setProperty('--c', c);
      b.addEventListener('click', () => {
        applyStyle({ color: c }, true);
        renderProps();
      });
      grid.append(b);
    }
    const custom = h('input', { type: 'color', value: color, 'aria-label': tr('annCustomColor') });
    custom.addEventListener('input', () => applyStyle({ color: custom.value }, false));
    custom.addEventListener('change', () => {
      applyStyle({ color: custom.value }, true);
      renderProps();
    });
    grid.append(h('label', { class: 'swatch custom', title: tr('annCustomColor') }, custom));
    props.append(h('div', { class: 'prop' }, h('div', { class: 'prop-label' }, h('span', {}, tr('annColor'))), grid));
  }
  if (n.width) {
    const v = current && 'width' in current ? current.width : style.width;
    props.append(slider('annWidth', 1, 40, v, (w, done) => applyStyle({ width: w }, done)));
  }
  if (n.fill) {
    const on = current && isBox(current) ? current.fill : style.fill;
    const sw = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-label': tr('annFill'), 'aria-checked': String(on) });
    sw.addEventListener('click', () => {
      const next = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(next));
      applyStyle({ fill: next }, true);
    });
    props.append(h('div', { class: 'prop-row' }, h('span', {}, tr('annFill')), sw));
  }
  if (n.size) {
    const v = current?.kind === 'text' ? current.size : current?.kind === 'step' ? Math.round(current.size / 1.1) : style.textSize;
    props.append(slider('annTextSize', 12, 160, v, (size, done) => applyStyle({ textSize: size }, done)));
  }
  if (n.strength) {
    const v = current && isBox(current) ? current.strength : style.strength;
    props.append(slider('annStrength', 2, 60, v, (strength, done) => applyStyle({ strength }, done)));
  }
  if (current) {
    props.append(textBtn('btn danger', tr('annDelete'), stroke(TRASH, 16), deleteSelected));
  } else if (tool === 'select' || tool === 'crop') {
    props.append(h('p', { class: 'hint' }, tr(tool === 'crop' ? 'annCropHint' : 'annSelectHint')));
  }
}

function deleteSelected(): void {
  if (!selected) return;
  const s = selected;
  shapes = shapes.filter((x) => x !== s);
  if (isEffect(s)) baseDirty = true;
  selected = null;
  commit();
  renderProps();
  render();
}

async function loadImage(src: string): Promise<boolean> {
  const img = new Image();
  img.src = src;
  try {
    await img.decode();
  } catch {
    toast(tr('annOpenFailed'), true);
    return false;
  }
  if (editing) finishText();
  image = img;
  crop = { x: 0, y: 0, w: img.naturalWidth, h: img.naturalHeight };
  shapes = [];
  selected = null;
  baseDirty = true;
  view.fit = true;
  commit();
  renderProps();
  render();
  return true;
}

async function openFile(): Promise<void> {
  const src = await desk.invoke<string | null>(CH.annotateOpenFile);
  if (src === null) return;
  if (!src) toast(tr('annOpenFailed'), true);
  else await loadImage(src);
}

function exportPng(): Promise<Uint8Array | null> {
  if (!image) return Promise.resolve(null);
  if (editing) finishText();
  renderScene();
  const out = document.createElement('canvas');
  out.width = crop.w;
  out.height = crop.h;
  out.getContext('2d')!.drawImage(scene, crop.x, crop.y, crop.w, crop.h, 0, 0, crop.w, crop.h);
  return new Promise((resolve) =>
    out.toBlob(async (blob) => resolve(blob ? new Uint8Array(await blob.arrayBuffer()) : null), 'image/png'),
  );
}

const outputButtons: HTMLButtonElement[] = [];

async function output(action: AnnotateAction): Promise<void> {
  if (busy || !image) return;
  if (action === 'upload' && !hasKey) {
    toast(tr('annNoKey'), true);
    return;
  }
  busy = true;
  outputButtons.forEach((b) => (b.disabled = true));
  if (action === 'upload') toast(tr('annWorking'));
  try {
    const png = await exportPng();
    if (!png) return;
    const res = await desk.invoke<AnnotateResult>(CH.annotateOutput, { action, png });
    if (res.ok) toast(tr(action === 'upload' ? 'annUploaded' : action === 'save' ? 'annSaved' : 'annCopied'));
    else if (res.error) toast(tr(IMAGE_ERRORS[res.error]), true);
  } finally {
    busy = false;
    outputButtons.forEach((b) => (b.disabled = false));
  }
}

document.addEventListener('paste', (e) => {
  if (editing) return;
  const file = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'))?.getAsFile();
  if (!file) return;
  e.preventDefault();
  const reader = new FileReader();
  reader.onload = () => void loadImage(String(reader.result));
  reader.readAsDataURL(file);
});

window.addEventListener('keydown', (e) => {
  if (editing) return;
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (e.key === ' ') {
    if (!spaceDown) {
      spaceDown = true;
      stage.dataset.cursor = 'grab';
    }
    e.preventDefault();
    return;
  }
  if (ctrl) {
    if (key === 'z' && !e.shiftKey) restore(at - 1);
    else if (key === 'y' || (key === 'z' && e.shiftKey)) restore(at + 1);
    else if (key === 'c' && !window.getSelection()?.toString()) void output('copy');
    else if (key === 's') void output('save');
    else if (key === 'o') void openFile();
    else if (key === '0') {
      view.fit = true;
      render(false);
    } else if (key === '=' || key === '+') zoomAt(1.25);
    else if (key === '-') zoomAt(0.8);
    else return;
    e.preventDefault();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    deleteSelected();
    return;
  }
  if (e.key === 'Escape') {
    selected = null;
    cropDraft = null;
    renderProps();
    render(false);
    return;
  }
  if (e.key.startsWith('Arrow') && selected) {
    const step = (e.shiftKey ? 10 : 1) / Math.max(1, view.scale);
    const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
    const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
    moveShape(selected, dx, dy);
    if (isEffect(selected)) baseDirty = true;
    commit();
    render();
    e.preventDefault();
    return;
  }
  const t = TOOLS.find((x) => x?.key === key);
  if (t && !e.altKey) setTool(t.id);
});

window.addEventListener('keyup', (e) => {
  if (e.key === ' ') {
    spaceDown = false;
    stage.dataset.cursor = cursorFor(tool);
  }
});

window.addEventListener('blur', () => (spaceDown = false));

function buildTop(): void {
  const top = document.getElementById('top') as HTMLElement;
  const logo = h('img', { src: LOGOS.images, alt: '' });
  undoBtn = iconBtn('btn icon', `${tr('annUndo')} (Ctrl+Z)`, stroke(UNDO, 16), () => restore(at - 1));
  redoBtn = iconBtn('btn icon', `${tr('annRedo')} (Ctrl+Y)`, stroke(REDO, 16), () => restore(at + 1));
  zoomLabel = h('span', { class: 'zoom' }, '100 %');
  const copy = textBtn('btn', tr('annCopy'), icon('copy', 16), () => void output('copy'));
  const save = textBtn('btn', tr('annSave'), stroke(SAVE, 16), () => void output('save'));
  const upload = textBtn('btn solid', tr('annUpload'), icon('upload', 16), () => void output('upload'));
  outputButtons.push(copy, save, upload);
  top.append(
    h('div', { class: 'ed-title' }, logo, tr('annTitle')),
    textBtn('btn', tr('annOpen'), icon('folder', 16), () => void openFile()),
    h('span', { class: 'sep' }),
    undoBtn,
    redoBtn,
    h('span', { class: 'sep' }),
    iconBtn('btn icon', tr('annZoomOut'), stroke(MINUS, 16), () => zoomAt(0.8)),
    zoomLabel,
    iconBtn('btn icon', tr('annZoomIn'), stroke(PLUS, 16), () => zoomAt(1.25)),
    iconBtn('btn icon', `${tr('annFit')} (Ctrl+0)`, stroke(FIT, 16), () => {
      view.fit = true;
      render(false);
    }),
    h('span', { class: 'spacer' }),
    copy,
    save,
    upload,
  );
  updateHistoryButtons();
}

function buildEmpty(): void {
  empty.append(
    h('h1', {}, tr('annEmpty')),
    h('p', {}, tr('annEmptyHint')),
    textBtn('btn solid', tr('annOpen'), icon('folder', 16), () => void openFile()),
  );
}

async function main(): Promise<void> {
  const init = await desk.invoke<AnnotateInit>(CH.annotateInit);
  setLocale(init.locale);
  void applyFont(init.font);
  hasKey = init.hasKey;
  document.title = `${tr('annTitle')} | haunt+`;
  buildTop();
  buildTools();
  buildEmpty();
  setTool(tool);
  new ResizeObserver(() => {
    if (editing) placeText();
    render(false);
  }).observe(stage);
  void document.fonts.ready.then(() => render());
  if (init.image) await loadImage(init.image);
  else render();
}

void main();
