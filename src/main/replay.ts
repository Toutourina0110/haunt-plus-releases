import { BrowserWindow, desktopCapturer, ipcMain, nativeImage, Notification, screen, shell, type Display } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import { t } from '../shared/i18n';
import type { Locale, ReplayInit, ReplaySaved, ReplaySaveRequest } from '../shared/types';
import { displayUnderMouse } from './capture';
import { SystemAudio } from './loopback';
import type { SettingsStore } from './settings';
import { assetFile, rendererFile, uiPrefs } from './util';

export interface ReplayDeps {
  locale: () => Locale;
  settings: SettingsStore;
  videoRoot: () => string;
  openClip: (file: string) => void;
}

const FPS = 30;
const SAVE_TIMEOUT = 30000;

export class Replay {
  private page: BrowserWindow | null = null;
  private sound: SystemAudio | null = null;
  private init: ReplayInit | null = null;
  private displays: Display[] = [];
  private nextId = 1;
  private readonly waiting = new Map<number, (saved: ReplaySaved | null) => void>();
  private readonly shown = new Set<Notification>();
  private restartTimer: NodeJS.Timeout | null = null;
  private saving = false;

  constructor(private readonly deps: ReplayDeps) {
    ipcMain.handle(CH.replayInit, (event): ReplayInit => {
      if (!this.isPage(event.sender) || !this.init) throw new Error('Unknown sender');
      return this.init;
    });
    ipcMain.on(CH.replaySaved, (event, data: unknown) => {
      if (!this.isPage(event.sender)) return;
      const saved = data as ReplaySaved;
      this.waiting.get(saved?.id)?.(saved);
    });
    ipcMain.on(CH.replayFailed, (event, message: unknown) => {
      if (!this.isPage(event.sender)) return;
      console.error('Replay failed:', message);
      const l = this.deps.locale();
      this.notify(t(l, 'replayFailed'), String(message).slice(0, 200));
      this.stop();
    });
    const later = () => {
      if (!this.page) return;
      if (this.restartTimer) clearTimeout(this.restartTimer);
      this.restartTimer = setTimeout(() => void this.apply(), 1500);
    };
    screen.on('display-added', later);
    screen.on('display-removed', later);
  }

  get running(): boolean {
    return !!this.page;
  }

  isPage(wc: Electron.WebContents | null): boolean {
    return !!wc && !!this.page && !this.page.isDestroyed() && wc === this.page.webContents;
  }

  async apply(): Promise<void> {
    this.stop();
    if (this.deps.settings.value('replayEnabled')) await this.start();
  }

  private async start(): Promise<void> {
    const s = this.deps.settings;
    const mode = s.value('replayMode');
    this.displays = mode === 'screen' ? screen.getAllDisplays() : [];
    const sources = this.displays.length ? await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } }) : [];
    const screens = this.displays.flatMap((d) => {
      const source = sources.find((src) => src.display_id === String(d.id)) ?? (sources.length === 1 ? sources[0] : undefined);
      return source ? [{ sourceId: source.id, width: Math.round(d.size.width * d.scaleFactor), height: Math.round(d.size.height * d.scaleFactor) }] : [];
    });
    if (mode === 'screen' && screens.length !== this.displays.length) this.displays = this.displays.slice(0, screens.length);
    this.init = { mode, seconds: s.value('replaySeconds'), fps: FPS, mic: s.value('replayMic'), micId: s.value('recordMic'), screens };

    const page = new BrowserWindow({
      show: false,
      webPreferences: { ...uiPrefs(), backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' },
    });
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    page.webContents.on('will-navigate', (event) => event.preventDefault());
    page.on('closed', () => {
      if (this.page === page) this.stop();
    });
    this.page = page;
    this.sound = new SystemAudio((dev, pcm) => {
      if (!page.isDestroyed()) page.webContents.send(CH.replayAudio, { dev, pcm });
    });
    page.webContents.once('did-finish-load', () => this.sound?.start());
    await page.loadFile(rendererFile('replay.html'));
  }

  stop(): void {
    this.sound?.stop();
    this.sound = null;
    const page = this.page;
    this.page = null;
    if (page && !page.isDestroyed()) page.destroy();
    for (const done of this.waiting.values()) done(null);
    this.waiting.clear();
  }

  async save(): Promise<void> {
    const l = this.deps.locale();
    if (!this.page || !this.init) {
      this.notify(t(l, 'replayOff'), t(l, 'replayOffBody'));
      return;
    }
    if (this.saving) return;
    this.saving = true;
    try {
      const under = displayUnderMouse();
      const at = this.displays.findIndex((d) => d.id === under.id);
      const req: ReplaySaveRequest = { id: this.nextId++, screen: this.init.mode === 'screen' ? Math.max(0, at) : -1 };
      const saved = await new Promise<ReplaySaved | null>((resolve) => {
        const timer = setTimeout(() => resolve(null), SAVE_TIMEOUT);
        this.waiting.set(req.id, (value) => {
          clearTimeout(timer);
          this.waiting.delete(req.id);
          resolve(value);
        });
        this.page?.webContents.send(CH.replaySave, req);
      });
      if (!saved?.bytes || !(saved.bytes instanceof Uint8Array) || (saved.ext !== 'mp4' && saved.ext !== 'm4a')) {
        this.notify(t(l, 'replayFailed'), saved?.error ? String(saved.error).slice(0, 200) : t(l, 'replayEmpty'));
        return;
      }
      const dir = path.join(this.deps.videoRoot(), 'Clips');
      await fs.promises.mkdir(dir, { recursive: true });
      const file = path.join(dir, `clip-${stamp()}.${saved.ext}`);
      await fs.promises.writeFile(file, saved.bytes);
      const thumb = typeof saved.thumb === 'string' && saved.thumb.startsWith('data:image/png;base64,') ? nativeImage.createFromDataURL(saved.thumb) : null;
      this.notify(t(l, 'replaySaved'), t(l, saved.ext === 'mp4' ? 'replaySavedBody' : 'replaySavedAudioBody'), thumb, () => {
        if (saved.ext === 'mp4') this.deps.openClip(file);
        else shell.showItemInFolder(file);
      });
    } finally {
      this.saving = false;
    }
  }

  private notify(title: string, body: string, image: Electron.NativeImage | null = null, onClick?: () => void): void {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title, body, icon: image && !image.isEmpty() ? image : assetFile('icon-tools.png') });
    this.shown.add(n);
    if (onClick) n.on('click', onClick);
    n.on('close', () => this.shown.delete(n));
    n.show();
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
