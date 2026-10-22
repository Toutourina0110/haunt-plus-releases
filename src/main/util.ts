import { app, shell, type Session, type WebContents, type WebContentsView, type WebPreferences } from 'electron';
import path from 'node:path';
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

export async function pageShot(view: WebContentsView): Promise<PageShot | null> {
  const [image, boxes] = await Promise.all([
    view.webContents.capturePage().catch(() => null),
    detectElements(view.webContents),
  ]);
  if (!image || image.isEmpty()) return null;
  return { jpeg: image.toJPEG(90), boxes };
}

export function openExternal(raw: string): void {
  const url = parseUrl(raw);
  if (!url || !['https:', 'http:', 'mailto:'].includes(url.protocol)) return;
  void shell.openExternal(url.toString());
}

export function load(wc: WebContents, url: string): void {
  wc.loadURL(url).catch(() => {});
}
