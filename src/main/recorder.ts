import { BrowserWindow, desktopCapturer, ipcMain, Notification, screen, session, webContents, type Display, type DesktopCapturerSource } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import { t } from '../shared/i18n';
import type {
  CursorLog,
  Locale,
  NormRect,
  RecBarInit,
  RecBarState,
  RecCommand,
  RecorderInit,
  RecordKind,
  RecordingSession,
  RecStarted,
  RecTrack,
} from '../shared/types';
import { displayUnderMouse, pickArea } from './capture';
import type { SettingsStore } from './settings';
import { assetFile, rendererFile, uiPrefs } from './util';

export interface RecorderDeps {
  locale: () => Locale;
  settings: SettingsStore;
  videoRoot: () => string;
  onDone: (dir: string) => void;
  onBusy: (busy: boolean) => void;
}

interface Active {
  dir: string;
  display: Display;
  area: NormRect | null;
  source: DesktopCapturerSource;
  page: BrowserWindow;
  bar: BrowserWindow | null;
  outline: BrowserWindow | null;
  streams: Partial<Record<RecTrack, fs.WriteStream>>;
  files: Partial<Record<RecTrack, string>>;
  offsets: RecStarted['offsets'];
  started: number;
  pausedAt: number | null;
  pausedTotal: number;
  cursor: CursorLog | null;
  timers: NodeJS.Timeout[];
  stopping: 'stop' | 'cancel' | null;
}

const TRACKS: RecTrack[] = ['screen', 'mic', 'webcam'];
const BAR = { width: 292, height: 48 };

export class Recorder {
  private active: Active | null = null;
  private starting = false;
  private buttons: ((vKey: number) => number) | null | undefined;

  constructor(private readonly deps: RecorderDeps) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      const a = this.active;
      const from = request.frame ? webContents.fromFrame(request.frame) : null;
      if (!a || !from || from !== a.page.webContents) return callback({});
      callback({ video: a.source, audio: request.audioRequested && deps.settings.value('recordSystemAudio') ? 'loopback' : undefined });
    });

    const fromPage = (sender: Electron.WebContents) => !!this.active && sender === this.active.page.webContents;
    const fromBar = (sender: Electron.WebContents) => !!this.active?.bar && sender === this.active.bar.webContents;

    ipcMain.handle(CH.recInit, (event): RecorderInit => {
      if (!fromPage(event.sender)) throw new Error('Unknown sender');
      const s = deps.settings;
      return { fps: s.value('recordFps'), cursor: s.value('recordCursor'), systemAudio: s.value('recordSystemAudio'), micId: s.value('recordMic'), webcamId: s.value('recordWebcam') };
    });
    ipcMain.on(CH.recStarted, (event, data: unknown) => {
      if (fromPage(event.sender)) this.started(data as RecStarted);
    });
    ipcMain.on(CH.recChunk, (event, data: unknown) => {
      if (!fromPage(event.sender)) return;
      const c = data as { track?: unknown; bytes?: unknown };
      if (!TRACKS.includes(c.track as RecTrack) || !(c.bytes instanceof Uint8Array)) return;
      this.active?.streams[c.track as RecTrack]?.write(Buffer.from(c.bytes));
    });
    ipcMain.on(CH.recDone, (event) => {
      if (fromPage(event.sender)) void this.finish();
    });
    ipcMain.on(CH.recFailed, (event, message: unknown) => {
      if (!fromPage(event.sender) || !this.active) return;
      console.error('Recording failed:', message);
      this.active.stopping = 'cancel';
      this.notify(t(deps.locale(), 'recFailed'), String(message).slice(0, 200));
      void this.finish();
    });
    ipcMain.handle(CH.recbarInit, (event): RecBarInit => {
      if (!fromBar(event.sender)) throw new Error('Unknown sender');
      return { locale: deps.locale(), font: deps.settings.value('font') };
    });
    ipcMain.on(CH.recbarAction, (event, action: unknown) => {
      if (fromBar(event.sender) && ['pause', 'resume', 'stop', 'cancel'].includes(action as string)) this.command(action as RecCommand);
    });
  }

  get recording(): boolean {
    return !!this.active;
  }

  isPage(wc: Electron.WebContents | null): boolean {
    return !!wc && !!this.active && wc === this.active.page.webContents;
  }

  async toggle(kind: RecordKind): Promise<void> {
    if (this.active) return this.command('stop');
    if (this.starting) return;
    this.starting = true;
    try {
      await this.start(kind);
    } catch (err) {
      console.error('Recording could not start:', err);
      this.notify(t(this.deps.locale(), 'recFailed'), String(err).slice(0, 200));
      this.cleanup(true);
    } finally {
      this.starting = false;
    }
  }

  private async start(kind: RecordKind): Promise<void> {
    const locale = this.deps.locale();
    let display = displayUnderMouse();
    let area: NormRect | null = null;
    if (kind === 'area') {
      const labels = { annotate: '', upload: '', copy: '', save: '', record: t(locale, 'recRecord'), cancel: t(locale, 'capCancel') };
      const picked = await pickArea(t(locale, 'recHint'), this.deps.settings.value('font'), labels, 'video');
      if (!picked || picked.action !== 'record') return;
      display = picked.display;
      const { width, height } = display.bounds;
      const r = picked.rect;
      area = { x: r.x / width, y: r.y / height, w: r.w / width, h: r.h / height };
      if (area.w > 0.995 && area.h > 0.995) area = null;
    }
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } });
    const source = sources.find((s) => s.display_id === String(display.id)) ?? (sources.length === 1 ? sources[0] : undefined);
    if (!source) throw new Error('Screen not found');

    const dir = path.join(this.deps.videoRoot(), 'Enregistrements', stamp());
    await fs.promises.mkdir(dir, { recursive: true });
    const page = new BrowserWindow({ show: false, webPreferences: { ...uiPrefs(), backgroundThrottling: false } });
    page.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    page.webContents.on('will-navigate', (event) => event.preventDefault());
    this.active = {
      dir,
      display,
      area,
      source,
      page,
      bar: null,
      outline: null,
      streams: {},
      files: {},
      offsets: {},
      started: 0,
      pausedAt: null,
      pausedTotal: 0,
      cursor: null,
      timers: [],
      stopping: null,
    };
    this.deps.onBusy(true);
    page.on('closed', () => {
      if (this.active?.page === page && !this.active.stopping) {
        this.active.stopping = 'cancel';
        void this.finish();
      }
    });
    await page.loadFile(rendererFile('recorder.html'));
  }

  private started(data: RecStarted): void {
    const a = this.active;
    if (!a || a.started) return;
    for (const track of TRACKS) {
      const mime = data.mimes?.[track];
      if (typeof mime !== 'string') continue;
      const file = `${track}.${mime.includes('mp4') ? 'mp4' : 'webm'}`;
      a.files[track] = file;
      a.streams[track] = fs.createWriteStream(path.join(a.dir, file));
    }
    a.offsets = {};
    for (const track of TRACKS) {
      const o = data.offsets?.[track];
      if (typeof o === 'number' && Number.isFinite(o)) a.offsets[track] = o;
    }
    a.started = Date.now();
    this.showBar(a);
    if (data.noSystemAudio) this.notify(t(this.deps.locale(), 'recNoSound'), t(this.deps.locale(), 'recNoSoundBody'));
    this.followMouse(a);
    a.timers.push(setInterval(() => this.sendState(), 500));
    this.sendState();
  }

  private elapsed(a: Active, now = Date.now()): number {
    if (!a.started) return 0;
    const paused = a.pausedTotal + (a.pausedAt ? now - a.pausedAt : 0);
    return Math.max(0, (now - a.started - paused) / 1000);
  }

  command(cmd: RecCommand): void {
    const a = this.active;
    if (!a || a.stopping) return;
    if (cmd === 'pause' && !a.pausedAt) a.pausedAt = Date.now();
    else if (cmd === 'resume' && a.pausedAt) {
      a.pausedTotal += Date.now() - a.pausedAt;
      a.pausedAt = null;
    } else if (cmd === 'stop' || cmd === 'cancel') {
      a.stopping = cmd;
      a.bar?.hide();
      a.outline?.hide();
      setTimeout(() => {
        if (this.active === a) void this.finish();
      }, 10000);
    } else return;
    a.page.webContents.send(CH.recCommand, cmd === 'cancel' ? 'stop' : cmd);
    this.sendState();
  }

  private sendState(): void {
    const a = this.active;
    if (!a?.bar || a.bar.isDestroyed()) return;
    const state: RecBarState = { paused: !!a.pausedAt, elapsed: this.elapsed(a) };
    a.bar.webContents.send(CH.recbarState, state);
  }

  private async finish(): Promise<void> {
    const a = this.active;
    if (!a) return;
    this.active = null;
    const duration = this.elapsed(a);
    a.timers.forEach((timer) => clearInterval(timer));
    await Promise.all(
      Object.values(a.streams).map((s) => new Promise<void>((resolve) => (s ? s.end(() => resolve()) : resolve()))),
    );
    for (const win of [a.page, a.bar, a.outline]) if (win && !win.isDestroyed()) win.destroy();
    this.deps.onBusy(false);
    if (a.stopping === 'cancel' || !a.started || !a.files.screen) {
      await fs.promises.rm(a.dir, { recursive: true, force: true }).catch(() => {});
      return;
    }
    const scale = a.display.scaleFactor;
    const info: RecordingSession = {
      version: 1,
      created: new Date().toISOString(),
      fps: this.deps.settings.value('recordFps'),
      display: { width: Math.round(a.display.bounds.width * scale), height: Math.round(a.display.bounds.height * scale), scale },
      area: a.area,
      files: a.files,
      offsets: a.offsets,
      duration,
      cursor: a.cursor ? 'cursor.json' : null,
    };
    if (a.cursor) await fs.promises.writeFile(path.join(a.dir, 'cursor.json'), JSON.stringify(a.cursor));
    await fs.promises.writeFile(path.join(a.dir, 'session.json'), JSON.stringify(info, null, 2));
    this.deps.onDone(a.dir);
  }

  private cleanup(remove: boolean): void {
    const a = this.active;
    if (!a) return;
    this.active = null;
    a.timers.forEach((timer) => clearInterval(timer));
    for (const s of Object.values(a.streams)) s?.end();
    for (const win of [a.page, a.bar, a.outline]) if (win && !win.isDestroyed()) win.destroy();
    this.deps.onBusy(false);
    if (remove) void fs.promises.rm(a.dir, { recursive: true, force: true }).catch(() => {});
  }

  private showBar(a: Active): void {
    const d = a.display.bounds;
    let x = Math.round(d.x + (d.width - BAR.width) / 2);
    let y = d.y + 16;
    if (a.area) {
      const r = { x: d.x + a.area.x * d.width, y: d.y + a.area.y * d.height, w: a.area.w * d.width, h: a.area.h * d.height };
      x = Math.round(r.x + (r.w - BAR.width) / 2);
      y = Math.round(r.y + r.h + 12);
      if (y + BAR.height > d.y + d.height - 8) y = Math.round(r.y - BAR.height - 12);
      if (y < d.y + 8) y = Math.round(r.y + 12);
      x = Math.max(d.x + 8, Math.min(d.x + d.width - BAR.width - 8, x));
      this.showOutline(a, r);
    }
    const bar = new BrowserWindow({
      x,
      y,
      ...BAR,
      frame: false,
      transparent: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      icon: assetFile('icon-tools.png'),
      webPreferences: uiPrefs(),
    });
    bar.setAlwaysOnTop(true, 'screen-saver');
    bar.setContentProtection(true);
    bar.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    bar.once('ready-to-show', () => bar.showInactive());
    a.bar = bar;
    void bar.loadFile(rendererFile('recbar.html'));
  }

  private showOutline(a: Active, r: { x: number; y: number; w: number; h: number }): void {
    const pad = 3;
    const win = new BrowserWindow({
      x: Math.round(r.x - pad),
      y: Math.round(r.y - pad),
      width: Math.round(r.w + pad * 2),
      height: Math.round(r.h + pad * 2),
      frame: false,
      transparent: true,
      resizable: false,
      focusable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      hasShadow: false,
      show: false,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setIgnoreMouseEvents(true);
    win.setContentProtection(true);
    win.once('ready-to-show', () => win.showInactive());
    a.outline = win;
    const html = `<!doctype html><html><body style="margin:0;height:100vh;box-sizing:border-box;border:2px dashed #e5484d;border-radius:4px"></body></html>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  }

  private notify(title: string, body: string): void {
    if (Notification.isSupported()) new Notification({ title, body, icon: assetFile('icon-tools.png') }).show();
  }

  private followMouse(a: Active): void {
    const s = this.deps.settings;
    if (!s.value('recordClicks') && !s.value('recordAutoZoom')) return;
    const log: CursorLog = { samples: [], clicks: [] };
    a.cursor = log;
    const read = this.buttonReader();
    const down = [false, false];
    let last = '';
    const d = a.display.bounds;
    a.timers.push(
      setInterval(() => {
        if (a.pausedAt || a.stopping) return;
        const p = screen.getCursorScreenPoint();
        const time = Math.round(this.elapsed(a) * 1000) / 1000;
        const x = Math.round(((p.x - d.x) / d.width) * 10000) / 10000;
        const y = Math.round(((p.y - d.y) / d.height) * 10000) / 10000;
        const key = `${x},${y}`;
        if (key !== last) {
          log.samples.push(time, x, y);
          last = key;
        }
        if (!read) return;
        [0x01, 0x02].forEach((vKey, button) => {
          const pressed = (read(vKey) & 0x8000) !== 0;
          if (pressed && !down[button]) log.clicks.push(time, x, y, button);
          down[button] = pressed;
        });
      }, 1000 / 60),
    );
  }

  private buttonReader(): ((vKey: number) => number) | null {
    if (this.buttons !== undefined) return this.buttons;
    try {
      const koffi = require('koffi') as typeof import('koffi');
      const user32 = koffi.load('user32.dll');
      this.buttons = user32.func('short __stdcall GetAsyncKeyState(int vKey)') as (vKey: number) => number;
    } catch (err) {
      console.warn('Mouse buttons cannot be read:', err);
      this.buttons = null;
    }
    return this.buttons;
  }
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
