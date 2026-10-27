import { app, nativeImage, shell, type NativeImage, type Session, type WebContents, type WebContentsView, type WebPreferences } from 'electron';
import path from 'node:path';
import { pickCards } from '../renderer/motion/geometry';
import type { PageShot } from '../shared/types';
import { detectElements } from './elements';
import { parseUrl } from './routing';

export const TITLEBAR = 40;

export function rendererFile(name: string): string {
  return path.join(__dirname, 'renderer', name);
}

export function assetFile(name: string): string {
  return path.join(__dirname, 'assets', name);
}

export function uiPrefs(): WebPreferences {
  return {
    preload: path.join(__dirname, 'preload-ui.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: false,
    devTools: !app.isPackaged,
  };
}

export function sitePrefs(session: Session): WebPreferences {
  return {
    session,
    preload: path.join(__dirname, 'preload-site.js'),
    contextIsolation: true,
    sandbox: true,
    nodeIntegration: false,
    spellcheck: true,
    devTools: !app.isPackaged,
  };
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function waitForStop(wc: WebContents, timeout: number): Promise<void> {
  return new Promise((resolve) => {
    if (!wc.isLoading()) return resolve();
    const done = () => {
      clearTimeout(timer);
      wc.removeListener('did-stop-loading', done);
      resolve();
    };
    const timer = setTimeout(done, timeout);
    wc.once('did-stop-loading', done);
  });
}

export async function snapshot(view: WebContentsView): Promise<string | null> {
  try {
    const image = await view.webContents.capturePage();
    if (image.isEmpty()) return null;
    return 'data:image/jpeg;base64,' + image.toJPEG(90).toString('base64');
  } catch {
    return null;
  }
}

export async function pageShot(view: WebContentsView, hidden = false): Promise<PageShot | null> {
  const [image, boxes] = await Promise.all([
    view.webContents.capturePage(undefined, hidden ? { stayHidden: true } : undefined).catch(() => null),
    detectElements(view.webContents),
  ]);
  if (!image || image.isEmpty()) return null;
  return encodeShot(image, boxes, hidden);
}

export function encodeShot(image: NativeImage, boxes: PageShot['boxes'], refuseBlank = false): PageShot | null {
  const at = Date.now();
  const scale = Math.max(1, ...image.getScaleFactors());
  const { width, height } = image.getSize(scale);
  const bgra = image.toBitmap({ scaleFactor: scale });
  if (refuseBlank && isBlank(bgra, width, height)) return null;
  const cards = pickCards(boxes, { data: bgra, width, height, bgr: true }, { w: width / scale, h: height / scale });
  const jpeg = nativeImage.createFromBitmap(bgra, { width, height }).toJPEG(95);
  return { jpeg, boxes, cards, at };
}

function isBlank(pixels: Uint8Array, width: number, height: number): boolean {
  let min = 255;
  let max = 0;
  for (let i = 0; i < 256; i++) {
    const x = Math.floor(((i % 16) + 0.5) * (width / 16));
    const y = Math.floor((Math.floor(i / 16) + 0.5) * (height / 16));
    const p = (y * width + x) * 4;
    const luma = (pixels[p] + pixels[p + 1] + pixels[p + 2]) / 3;
    min = Math.min(min, luma);
    max = Math.max(max, luma);
  }
  return max - min < 4;
}

export function openExternal(raw: string): void {
  const url = parseUrl(raw);
  if (!url || !['https:', 'http:', 'mailto:'].includes(url.protocol)) return;
  void shell.openExternal(url.toString());
}

export function load(wc: WebContents, url: string): void {
  wc.loadURL(url).catch(() => {});
}
