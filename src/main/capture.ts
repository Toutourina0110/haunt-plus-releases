import { BrowserWindow, desktopCapturer, ipcMain, nativeImage, screen, type Display, type NativeImage } from 'electron';
import { CH } from '../shared/channels';
import type { CaptureAction, CaptureDown, CaptureInit, CapturePick, CaptureRect, CaptureSync, PickAction } from '../shared/types';
import { rendererFile, uiPrefs } from './util';

interface Picker {
  win: BrowserWindow;
  display: Display;
  image: NativeImage;
  init: CaptureInit;
}

export interface Shot {
  display: Display;
  image: NativeImage;
}

interface Drag extends CaptureDown {
  from: Electron.Point;
  start: CaptureRect | null;
  timer: NodeJS.Timeout;
}

let picking: {
  pickers: Picker[];
  rect: CaptureRect | null;
  chosen: boolean;
  drag: Drag | null;
  resolve: (pick: { pick: CapturePick; picker: Picker } | null) => void;
} | null = null;
const ACTIONS: PickAction[] = ['annotate', 'upload', 'copy', 'save', 'record'];
const HANDLES = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const pickerOf = (sender: Electron.WebContents) => picking?.pickers.find((p) => p.win.webContents === sender);

export function setupCapture(): void {
  ipcMain.handle(CH.captureInit, (event) => {
    const picker = pickerOf(event.sender);
    if (!picker) throw new Error('Unknown sender');
    return picker.init;
  });
  ipcMain.on(CH.captureSelect, (event, data: unknown) => {
    const picker = pickerOf(event.sender);
    if (!picker || !picking) return;
    const pick = cleanPick(data);
    if (pick && !pick.whole && !picking.rect) return;
    picking.resolve(pick ? { pick, picker } : null);
  });
  ipcMain.on(CH.captureDown, (event, data: unknown) => {
    if (!pickerOf(event.sender) || !picking) return;
    const d = data as Partial<CaptureDown> | null;
    const mode = d?.mode;
    if (mode !== 'draw' && mode !== 'move' && mode !== 'resize') return;
    if (mode !== 'draw' && !(picking.rect && picking.chosen)) return;
    if (mode === 'resize' && !HANDLES.includes(d?.handle as string)) return;
    startDrag({ mode, handle: d?.handle });
  });
  ipcMain.on(CH.captureUp, (event) => {
    if (pickerOf(event.sender)) endDrag();
  });
}

function cleanPick(data: unknown): CapturePick | null {
  if (!data || typeof data !== 'object') return null;
  const p = data as { action?: unknown; whole?: unknown; all?: unknown };
  if (!ACTIONS.includes(p.action as PickAction)) return null;
  return { action: p.action as PickAction, whole: p.whole === true, all: p.all === true };
}

function desktop(): CaptureRect {
  const all = picking?.pickers.map((p) => p.display.bounds) ?? [];
  const x = Math.min(...all.map((b) => b.x));
  const y = Math.min(...all.map((b) => b.y));
  return { x, y, w: Math.max(...all.map((b) => b.x + b.width)) - x, h: Math.max(...all.map((b) => b.y + b.height)) - y };
}

function between(a: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, a));
}

function startDrag(down: CaptureDown): void {
  if (!picking) return;
  if (picking.drag) clearInterval(picking.drag.timer);
  const from = screen.getCursorScreenPoint();
  if (down.mode === 'draw') {
    picking.rect = null;
    picking.chosen = false;
  }
  const timer = setInterval(() => move(), 1000 / 120);
  picking.drag = { ...down, from, start: picking.rect && { ...picking.rect }, timer };
  sync();
}

function move(): void {
  const drag = picking?.drag;
  if (!picking || !drag) return;
  const d = desktop();
  const p = screen.getCursorScreenPoint();
  const x = between(p.x, d.x, d.x + d.w);
  const y = between(p.y, d.y, d.y + d.h);
  const s = drag.start;
  if (drag.mode === 'draw') {
    picking.rect = { x: Math.min(drag.from.x, x), y: Math.min(drag.from.y, y), w: Math.abs(x - drag.from.x), h: Math.abs(y - drag.from.y) };
  } else if (drag.mode === 'move' && s) {
    picking.rect = { ...s, x: between(s.x + p.x - drag.from.x, d.x, d.x + d.w - s.w), y: between(s.y + p.y - drag.from.y, d.y, d.y + d.h - s.h) };
  } else if (s) {
    const h = drag.handle ?? '';
    let [x1, y1, x2, y2] = [s.x, s.y, s.x + s.w, s.y + s.h];
    if (h.includes('w')) x1 = x;
    if (h.includes('e')) x2 = x;
    if (h.includes('n')) y1 = y;
    if (h.includes('s')) y2 = y;
    picking.rect = { x: Math.min(x1, x2), y: Math.min(y1, y2), w: Math.abs(x2 - x1), h: Math.abs(y2 - y1) };
  }
  sync();
}

function endDrag(): void {
  const drag = picking?.drag;
  if (!picking || !drag) return;
  move();
  clearInterval(drag.timer);
  picking.drag = null;
  const r = picking.rect;
  picking.chosen = !!r && r.w >= 4 && r.h >= 4;
  if (!picking.chosen) picking.rect = null;
  sync();
}

function sync(): void {
  if (!picking) return;
  const r = picking.rect;
  const home = r ? screen.getDisplayNearestPoint({ x: Math.round(r.x + r.w - 1), y: Math.round(r.y + r.h - 1) }).id : -1;
  for (const p of picking.pickers) {
    if (p.win.isDestroyed()) continue;
    const state: CaptureSync = { rect: r, chosen: picking.chosen, bar: p.display.id === home };
    p.win.webContents.send(CH.captureSync, state);
  }
}

export function displayUnderMouse(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

export function overlaps(a: Electron.Rectangle, r: CaptureRect): boolean {
  return r.x < a.x + a.width && r.x + r.w > a.x && r.y < a.y + a.height && r.y + r.h > a.y;
}

async function grabAll(displays: Display[]): Promise<Shot[]> {
  const width = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
  const height = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    return displays.flatMap((display) => {
      const source = sources.find((s) => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
      if (!source || source.thumbnail.isEmpty()) return [];
      const w = Math.round(display.size.width * display.scaleFactor);
      const h = Math.round(display.size.height * display.scaleFactor);
      const size = source.thumbnail.getSize();
      const image = size.width === w && size.height === h ? source.thumbnail : source.thumbnail.resize({ width: w, height: h, quality: 'best' });
      return [{ display, image }];
    });
  } catch {
    return [];
  }
}

function combine(shots: Shot[]): { image: NativeImage; x: number; y: number; scale: number } {
  const scale = Math.max(...shots.map((s) => s.display.scaleFactor));
  const left = Math.min(...shots.map((s) => s.display.bounds.x));
  const top = Math.min(...shots.map((s) => s.display.bounds.y));
  const right = Math.max(...shots.map((s) => s.display.bounds.x + s.display.bounds.width));
  const bottom = Math.max(...shots.map((s) => s.display.bounds.y + s.display.bounds.height));
  const width = Math.round((right - left) * scale);
  const height = Math.round((bottom - top) * scale);
  const out = Buffer.alloc(width * height * 4);
  for (let i = 3; i < out.length; i += 4) out[i] = 255;
  for (const { display, image } of shots) {
    const w = Math.round(display.bounds.width * scale);
    const h = Math.round(display.bounds.height * scale);
    const size = image.getSize();
    const fitted = size.width === w && size.height === h ? image : image.resize({ width: w, height: h, quality: 'best' });
    const bitmap = fitted.toBitmap();
    const x0 = Math.round((display.bounds.x - left) * scale);
    const y0 = Math.round((display.bounds.y - top) * scale);
    const rowBytes = Math.min(w, width - x0) * 4;
    for (let y = 0; y < h && y0 + y < height; y++) {
      bitmap.copy(out, ((y0 + y) * width + x0) * 4, y * w * 4, y * w * 4 + rowBytes);
    }
  }
  return { image: nativeImage.createFromBitmap(out, { width, height }), x: left, y: top, scale };
}

function cropShots(shots: Shot[], rect: CaptureRect): NativeImage | null {
  const hit = shots.filter((s) => overlaps(s.display.bounds, rect));
  if (!hit.length) return null;
  const one = hit.length === 1 && hit[0];
  const src = one
    ? { image: one.image, x: one.display.bounds.x, y: one.display.bounds.y, scale: one.image.getSize().width / one.display.bounds.width }
    : combine(hit);
  const size = src.image.getSize();
  const x = between(Math.round((rect.x - src.x) * src.scale), 0, size.width);
  const y = between(Math.round((rect.y - src.y) * src.scale), 0, size.height);
  const w = Math.min(size.width - x, Math.round(rect.w * src.scale));
  const h = Math.min(size.height - y, Math.round(rect.h * src.scale));
  if (w < 2 || h < 2) return null;
  return src.image.crop({ x, y, width: w, height: h });
}

export async function captureScreen(
  hint: string,
  font: string,
  labels: CaptureInit['labels'],
  screens: NonNullable<CaptureInit['screens']>,
): Promise<NativeImage | null> {
  if (screen.getAllDisplays().length < 2) return (await grabAll([displayUnderMouse()]))[0]?.image ?? null;
  const picked = await openPickers(hint, font, labels, 'screen', screens);
  if (!picked) return null;
  return picked.all ? combine(picked.shots).image : cropShots(picked.shots, picked.rect);
}

export async function captureArea(
  hint: string,
  font: string,
  labels: CaptureInit['labels'],
): Promise<{ image: NativeImage; action: CaptureAction } | null> {
  const picked = await pickArea(hint, font, labels, 'shot');
  if (!picked || picked.action === 'record') return null;
  const image = cropShots(picked.shots, picked.rect);
  return image ? { image, action: picked.action } : null;
}

export async function pickArea(
  hint: string,
  font: string,
  labels: CaptureInit['labels'],
  mode: CaptureInit['mode'],
): Promise<{ shots: Shot[]; rect: CaptureRect; action: PickAction } | null> {
  const picked = await openPickers(hint, font, labels, mode);
  return picked && { shots: picked.shots, rect: picked.rect, action: picked.action };
}

async function openPickers(
  hint: string,
  font: string,
  labels: CaptureInit['labels'],
  mode: CaptureInit['mode'],
  screens?: CaptureInit['screens'],
): Promise<{ action: PickAction; rect: CaptureRect; all: boolean; shots: Shot[] } | null> {
  if (picking) return null;
  const shots = await grabAll(screen.getAllDisplays());
  if (!shots.length) return null;
  const home = displayUnderMouse();

  const pickers: Picker[] = shots.map(({ display, image }) => {
    const win = new BrowserWindow({
      ...display.bounds,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      enableLargerThanScreen: true,
      show: false,
      backgroundColor: '#000000',
      webPreferences: uiPrefs(),
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.webContents.on('will-navigate', (event) => event.preventDefault());
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const init: CaptureInit = {
      image: 'data:image/jpeg;base64,' + image.toJPEG(92).toString('base64'),
      hint,
      font,
      mode,
      labels,
      screens,
      origin: { x: display.bounds.x, y: display.bounds.y },
    };
    return { win, display, image, init };
  });

  const result = await new Promise<{ pick: CapturePick; picker: Picker } | null>((resolve) => {
    let done = false;
    const finish = (value: { pick: CapturePick; picker: Picker } | null) => {
      if (done) return;
      done = true;
      resolve(value);
    };
    picking = { pickers, rect: null, chosen: false, drag: null, resolve: finish };
    for (const p of pickers) {
      p.win.on('closed', () => finish(null));
      p.win.once('ready-to-show', () => {
        p.win.setBounds(p.display.bounds);
        p.win.show();
        if (p.display.id === home.id) p.win.focus();
      });
      p.win.loadFile(rendererFile('capture.html')).catch(() => finish(null));
    }
  });
  const held = picking as { rect: CaptureRect | null; drag: Drag | null } | null;
  const rect = held?.rect ?? null;
  if (held?.drag) clearInterval(held.drag.timer);
  picking = null;
  for (const p of pickers) if (!p.win.isDestroyed()) p.win.destroy();
  if (!result) return null;
  const b = result.picker.display.bounds;
  const area = result.pick.whole || !rect ? { x: b.x, y: b.y, w: b.width, h: b.height } : rect;
  return { action: result.pick.action, rect: area, all: !!result.pick.all, shots };
}
