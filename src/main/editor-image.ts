import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, nativeImage, net, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import type { AnnotateAction, AnnotateInit, AnnotateResult, AnnotateSource, Locale, UploadOutcome } from '../shared/types';
import type { SettingsStore } from './settings';
import { assetFile, rendererFile, uiPrefs } from './util';

export interface ImageEditorDeps {
  locale: () => Locale;
  isDark: () => boolean;
  settings: SettingsStore;
  hasKey: () => boolean;
  upload: (png: Buffer) => Promise<UploadOutcome>;
}

const TITLEBAR = 44;
const MAX_INPUT = 60 * 1024 * 1024;
const MAX_OUTPUT = 200 * 1024 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const IMAGE_HOSTS = new Set(['images.haunt.gg', 'i.haunt.gg']);

export class ImageEditors {
  private readonly windows = new Map<WebContents, { win: BrowserWindow; image: string | null }>();

  constructor(private readonly deps: ImageEditorDeps) {
    ipcMain.handle(CH.annotateInit, (event): AnnotateInit => {
      const entry = this.entry(event.sender);
      return {
        image: entry.image,
        locale: deps.locale(),
        dark: deps.isDark(),
        font: deps.settings.value('font'),
        hasKey: deps.hasKey(),
      };
    });
    ipcMain.handle(CH.annotateOpenFile, async (event) => {
      const { win } = this.entry(event.sender);
      const res = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
      });
      if (res.canceled || !res.filePaths[0]) return null;
      const png = await readImageFile(res.filePaths[0]);
      return png ? dataUrl(png) : '';
    });
    ipcMain.handle(CH.annotateOutput, async (event, raw: unknown): Promise<AnnotateResult> => {
      const { win } = this.entry(event.sender);
      const req = (raw && typeof raw === 'object' ? raw : {}) as { action?: unknown; png?: unknown };
      const action = req.action as AnnotateAction;
      if (!['upload', 'save', 'copy'].includes(action) || !(req.png instanceof Uint8Array)) return { ok: false };
      const png = Buffer.from(req.png);
      if (png.length > MAX_OUTPUT || !png.subarray(0, 8).equals(PNG_MAGIC)) return { ok: false };
      if (action === 'upload') {
        if (!deps.hasKey()) return { ok: false, error: 'NO_KEY' };
        const out = await deps.upload(png);
        return out.ok ? { ok: true, link: out.link } : { ok: false, error: out.error };
      }
      if (action === 'copy') {
        await clipboard.write([new ClipboardItem({ 'image/png': new Blob([png], { type: 'image/png' }) })]);
        return { ok: true };
      }
      const dir = path.join(app.getPath('pictures'), 'haunt+');
      await fs.promises.mkdir(dir, { recursive: true }).catch(() => {});
      const res = await dialog.showSaveDialog(win, {
        defaultPath: path.join(dir, `haunt-${stamp()}.png`),
        filters: [{ name: 'PNG', extensions: ['png'] }],
      });
      if (res.canceled || !res.filePath) return { ok: false };
      await fs.promises.writeFile(res.filePath, png);
      return { ok: true };
    });
  }

  private entry(sender: WebContents) {
    const entry = this.windows.get(sender);
    if (!entry) throw new Error('Unknown sender');
    return entry;
  }

  openPng(png: Buffer | null): void {
    this.open(png ? dataUrl(png) : null);
  }

  async openSource(raw: unknown): Promise<void> {
    const src = (raw && typeof raw === 'object' ? raw : {}) as Partial<AnnotateSource> & { url?: unknown };
    if (src.kind === 'blank') return this.open(null);
    if (src.kind !== 'url' || typeof src.url !== 'string') return;
    let url: URL;
    try {
      url = new URL(src.url);
    } catch {
      return;
    }
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) return;
    try {
      const res = await net.fetch(url.href);
      if (!res.ok) return;
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length > MAX_INPUT) return;
      const image = nativeImage.createFromBuffer(bytes);
      this.open(image.isEmpty() ? `data:${res.headers.get('content-type') ?? 'image/png'};base64,${bytes.toString('base64')}` : dataUrl(image.toPNG()));
    } catch (err) {
      console.warn('Could not open the picture in the editor:', err);
    }
  }

  private open(image: string | null): void {
    const dark = this.deps.isDark();
    const bg = dark ? '#060606' : '#ffffff';
    const win = new BrowserWindow({
      width: 1280,
      height: 820,
      minWidth: 720,
      minHeight: 480,
      show: false,
      title: 'haunt+',
      icon: assetFile('icon-tools.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: bg, symbolColor: dark ? '#fafafa' : '#0a0a0a', height: TITLEBAR },
      backgroundColor: bg,
      webPreferences: uiPrefs(),
    });
    const wc = win.webContents;
    this.windows.set(wc, { win, image });
    win.on('closed', () => this.windows.delete(wc));
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => {
      win.show();
      win.focus();
    });
    void win.loadFile(rendererFile('annotate.html'));
  }
}

function dataUrl(png: Buffer): string {
  return `data:image/png;base64,${png.toString('base64')}`;
}

async function readImageFile(file: string): Promise<Buffer | null> {
  try {
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > MAX_INPUT) return null;
    const bytes = await fs.promises.readFile(file);
    const image = nativeImage.createFromBuffer(bytes);
    if (!image.isEmpty()) return image.toPNG();
    return bytes;
  } catch {
    return null;
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
