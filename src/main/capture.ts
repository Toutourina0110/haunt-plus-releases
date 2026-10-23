import { BrowserWindow, desktopCapturer, ipcMain, screen, type Display, type NativeImage } from 'electron';
import { CH } from '../shared/channels';
import type { CaptureAction, CaptureInit, CapturePick, CaptureRect, PickAction } from '../shared/types';
import { rendererFile, uiPrefs } from './util';

let picking: { win: BrowserWindow; init: CaptureInit; resolve: (pick: CapturePick | null) => void } | null = null;
const ACTIONS: PickAction[] = ['annotate', 'upload', 'copy', 'save', 'record'];

export function setupCapture(): void {
  ipcMain.handle(CH.captureInit, (event) => {
    if (!picking || event.sender !== picking.win.webContents) throw new Error('Unknown sender');
    return picking.init;
  });
  ipcMain.on(CH.captureSelect, (event, data: unknown) => {
    if (picking && event.sender === picking.win.webContents) picking.resolve(cleanPick(data));
  });
}

function cleanPick(data: unknown): CapturePick | null {
  if (!data || typeof data !== 'object') return null;
  const p = data as { rect?: Record<string, unknown>; action?: unknown };
  const r = p.rect;
  if (!r || !ACTIONS.includes(p.action as PickAction)) return null;
  const values = [r.x, r.y, r.w, r.h];
  if (!values.every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  return { rect: { x: r.x as number, y: r.y as number, w: r.w as number, h: r.h as number }, action: p.action as PickAction };
}

export function displayUnderMouse(): Display {
  return screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
}

async function grab(display: Display): Promise<NativeImage | null> {
  const width = Math.round(display.size.width * display.scaleFactor);
  const height = Math.round(display.size.height * display.scaleFactor);
  try {
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width, height } });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
    return source && !source.thumbnail.isEmpty() ? source.thumbnail : null;
  } catch {
    return null;
  }
}

export function captureScreen(): Promise<NativeImage | null> {
  return grab(displayUnderMouse());
}

export async function captureArea(
  hint: string,
  font: string,
  labels: CaptureInit['labels'],
): Promise<{ image: NativeImage; action: CaptureAction } | null> {
  const picked = await pickArea(hint, font, labels, 'shot');
  if (!picked || picked.action === 'record') return null;
  const { image, display, rect } = picked;
  const k = display.scaleFactor;
  const size = image.getSize();
  const x = Math.max(0, Math.min(size.width, Math.round(rect.x * k)));
  const y = Math.max(0, Math.min(size.height, Math.round(rect.y * k)));
  const w = Math.min(size.width - x, Math.round(rect.w * k));
  const h = Math.min(size.height - y, Math.round(rect.h * k));
  if (w < 2 || h < 2) return null;
  return { image: image.crop({ x, y, width: w, height: h }), action: picked.action };
}

export async function pickArea(
  hint: string,
  font: string,
  labels: CaptureInit['labels'],
  mode: CaptureInit['mode'],
): Promise<{ image: NativeImage; display: Display; rect: CaptureRect; action: PickAction } | null> {
  if (picking) return null;
  const display = displayUnderMouse();
  const image = await grab(display);
  if (!image) return null;

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

  const pick = await new Promise<CapturePick | null>((resolve) => {
    picking = { win, init: { image: 'data:image/jpeg;base64,' + image.toJPEG(92).toString('base64'), hint, font, mode, labels }, resolve };
    win.on('closed', () => resolve(null));
    win.once('ready-to-show', () => {
      win.setBounds(display.bounds);
      win.show();
      win.focus();
    });
    win.loadFile(rendererFile('capture.html')).catch(() => resolve(null));
  });
  picking = null;
  if (!win.isDestroyed()) win.destroy();
  if (!pick) return null;
  return { image, display, rect: pick.rect, action: pick.action };
}
