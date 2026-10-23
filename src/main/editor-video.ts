import { app, BrowserWindow, clipboard, ClipboardItem, dialog, ipcMain, net, shell, type WebContents } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { CH } from '../shared/channels';
import type {
  ImageListResult,
  Locale,
  Project,
  ProjectSummary,
  RecordingSession,
  RecordingSummary,
  RecTrack,
  SessionMedia,
  UploadOutcome,
  VideoInit,
  VideoOutputAction,
} from '../shared/types';
import { MEDIA_EXTENSIONS, mediaUrl, type MediaGrants } from './media-protocol';
import type { SettingsStore } from './settings';
import { assetFile, rendererFile, uiPrefs } from './util';

export interface VideoEditorDeps {
  locale: () => Locale;
  isDark: () => boolean;
  settings: SettingsStore;
  hasKey: () => boolean;
  root: () => string;
  grants: MediaGrants;
  list: (query: unknown) => Promise<ImageListResult>;
  upload: (name: string, mime: string, data: Buffer) => Promise<UploadOutcome>;
}

const TITLEBAR = 44;
const SAFE_ID = /^[\w-]{1,80}$/;
const IMAGE_HOSTS = new Set(['images.haunt.gg', 'i.haunt.gg']);
const MAX_DOWNLOAD = 500 * 1024 * 1024;
const MAX_UPLOAD = 250 * 1024 * 1024;

interface Export {
  fd: number;
  file: string;
  owner: WebContents;
}

export class VideoEditors {
  private readonly windows = new Map<WebContents, { win: BrowserWindow; projectId: string | null; recording: string | null }>();
  private readonly exports = new Map<string, Export>();

  constructor(private readonly deps: VideoEditorDeps) {
    ipcMain.handle(CH.videoInit, async (event): Promise<VideoInit> => {
      const entry = this.entry(event.sender);
      return {
        locale: deps.locale(),
        dark: deps.isDark(),
        font: deps.settings.value('font'),
        hasKey: deps.hasKey(),
        project: entry.projectId ? await this.readProject(entry.projectId) : null,
        recording: entry.recording ? await this.readRecording(entry.recording) : null,
        recent: await this.projects(),
        autoZoom: deps.settings.value('recordAutoZoom'),
      };
    });
    ipcMain.handle(CH.videoCall, async (event, raw: unknown) => {
      const entry = this.entry(event.sender);
      const req = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      return this.call(entry.win, event.sender, req);
    });
    ipcMain.on(CH.videoExportWrite, (event, raw: unknown) => {
      const req = (raw && typeof raw === 'object' ? raw : {}) as { token?: unknown; position?: unknown; data?: unknown };
      const job = typeof req.token === 'string' ? this.exports.get(req.token) : undefined;
      if (!job || job.owner !== event.sender || !(req.data instanceof Uint8Array) || typeof req.position !== 'number') return;
      fs.writeSync(job.fd, req.data, 0, req.data.length, req.position);
    });
  }

  private entry(sender: WebContents) {
    const entry = this.windows.get(sender);
    if (!entry) throw new Error('Unknown sender');
    return entry;
  }

  private dirs() {
    const root = this.deps.root();
    return {
      root,
      projects: path.join(root, 'Projets'),
      recordings: path.join(root, 'Enregistrements'),
      imports: path.join(root, 'Imports'),
      exports: path.join(root, 'Exports'),
    };
  }

  open(opts: { projectId?: string; recording?: string } = {}): void {
    const dark = this.deps.isDark();
    const bg = dark ? '#060606' : '#ffffff';
    const win = new BrowserWindow({
      width: 1440,
      height: 900,
      minWidth: 960,
      minHeight: 600,
      show: false,
      title: 'haunt+',
      icon: assetFile('icon-tools.png'),
      titleBarStyle: 'hidden',
      titleBarOverlay: { color: bg, symbolColor: dark ? '#fafafa' : '#0a0a0a', height: TITLEBAR },
      backgroundColor: bg,
      webPreferences: uiPrefs(),
    });
    const wc = win.webContents;
    this.windows.set(wc, { win, projectId: opts.projectId ?? null, recording: opts.recording ?? null });
    win.on('closed', () => {
      this.windows.delete(wc);
      for (const [token, job] of this.exports) if (job.owner === wc) this.closeExport(token, false);
    });
    wc.on('will-navigate', (event) => event.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.once('ready-to-show', () => {
      win.maximize();
      win.show();
    });
    void win.loadFile(rendererFile('video.html'));
  }

  private async call(win: BrowserWindow, sender: WebContents, req: Record<string, unknown>): Promise<unknown> {
    const d = this.dirs();
    switch (req.op) {
      case 'projects':
        return this.projects();
      case 'recordings':
        return this.recordings();
      case 'openProject':
        return typeof req.id === 'string' && SAFE_ID.test(req.id) ? this.readProject(req.id) : null;
      case 'openRecording':
        return typeof req.dir === 'string' && SAFE_ID.test(req.dir) ? this.readRecording(req.dir) : null;
      case 'saveProject':
        return this.saveProject(req.project);
      case 'importFiles': {
        const res = await dialog.showOpenDialog(win, {
          properties: ['openFile', 'multiSelections'],
          filters: [{ name: 'Media', extensions: MEDIA_EXTENSIONS }],
        });
        if (res.canceled) return [];
        return res.filePaths.map((file) => {
          this.deps.grants.grant(file);
          return { path: file, url: mediaUrl(file), name: path.basename(file) };
        });
      }
      case 'galleryList':
        return this.deps.list(req.query);
      case 'galleryImport':
        return this.download(req.url, req.name);
      case 'exportBegin': {
        const ext = req.ext === 'gif' ? 'gif' : 'mp4';
        const base = cleanName(typeof req.name === 'string' ? req.name : '') || 'haunt';
        await fs.promises.mkdir(d.exports, { recursive: true });
        const file = path.join(d.exports, `${base} ${stamp()}.${ext}`);
        const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
        this.exports.set(token, { fd: fs.openSync(file, 'w'), file, owner: sender });
        return token;
      }
      case 'exportEnd':
        return typeof req.token === 'string' ? this.closeExport(req.token, req.ok === true) : null;
      case 'output':
        return this.output(win, req.path, req.action);
      case 'saveSound':
        return this.saveSound(req.name, req.data);
      default:
        return null;
    }
  }

  private closeExport(token: string, ok: boolean): { path: string; size: number } | null {
    const job = this.exports.get(token);
    if (!job) return null;
    this.exports.delete(token);
    fs.closeSync(job.fd);
    if (!ok) {
      fs.rmSync(job.file, { force: true });
      return null;
    }
    return { path: job.file, size: fs.statSync(job.file).size };
  }

  private async output(win: BrowserWindow, raw: unknown, action: unknown): Promise<UploadOutcome | { ok: boolean }> {
    const exportsDir = path.resolve(this.dirs().exports) + path.sep;
    if (typeof raw !== 'string' || !path.resolve(raw).startsWith(exportsDir)) return { ok: false };
    const file = path.resolve(raw);
    const kind = action as VideoOutputAction;
    if (kind === 'folder') {
      shell.showItemInFolder(file);
      return { ok: true };
    }
    if (kind === 'upload') {
      const size = (await fs.promises.stat(file)).size;
      if (size > MAX_UPLOAD) return { ok: false, error: 'FILE_TOO_LARGE', name: path.basename(file) };
      const mime = file.endsWith('.gif') ? 'image/gif' : 'video/mp4';
      return this.deps.upload(path.basename(file), mime, await fs.promises.readFile(file));
    }
    if (kind === 'save') {
      const res = await dialog.showSaveDialog(win, { defaultPath: path.join(app.getPath('videos'), path.basename(file)) });
      if (res.canceled || !res.filePath) return { ok: false };
      await fs.promises.copyFile(file, res.filePath);
      return { ok: true };
    }
    if (kind === 'copy') {
      const data = Buffer.from(`${file}\0`, 'utf16le');
      await clipboard.write([new ClipboardItem({ 'electron application/osclipboard;format="FileNameW"': new Blob([data]) })]);
      return { ok: true };
    }
    return { ok: false };
  }

  private async projects(): Promise<ProjectSummary[]> {
    const dir = this.dirs().projects;
    const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
    const out: ProjectSummary[] = [];
    for (const id of names) {
      if (!SAFE_ID.test(id)) continue;
      try {
        const p = JSON.parse(await fs.promises.readFile(path.join(dir, id, 'project.json'), 'utf8')) as Project;
        out.push({ id, name: String(p.name ?? id), updated: String(p.updated ?? '') });
      } catch {
      }
    }
    return out.sort((a, b) => b.updated.localeCompare(a.updated)).slice(0, 40);
  }

  private async readProject(id: string): Promise<Project | null> {
    try {
      return JSON.parse(await fs.promises.readFile(path.join(this.dirs().projects, id, 'project.json'), 'utf8')) as Project;
    } catch {
      return null;
    }
  }

  private async saveProject(raw: unknown): Promise<boolean> {
    const p = raw as Project | null;
    if (!p || typeof p !== 'object' || typeof p.id !== 'string' || !SAFE_ID.test(p.id)) return false;
    const json = JSON.stringify(p);
    if (json.length > 8 * 1024 * 1024) return false;
    const dir = path.join(this.dirs().projects, p.id);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, 'project.json.tmp');
    await fs.promises.writeFile(tmp, json);
    await fs.promises.rename(tmp, path.join(dir, 'project.json'));
    return true;
  }

  private async recordings(): Promise<RecordingSummary[]> {
    const dir = this.dirs().recordings;
    const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
    const out: RecordingSummary[] = [];
    for (const name of names) {
      if (!SAFE_ID.test(name)) continue;
      try {
        const s = JSON.parse(await fs.promises.readFile(path.join(dir, name, 'session.json'), 'utf8')) as RecordingSession;
        out.push({ dir: name, created: String(s.created ?? ''), duration: Number(s.duration) || 0 });
      } catch {
      }
    }
    return out.sort((a, b) => b.created.localeCompare(a.created)).slice(0, 40);
  }

  private async readRecording(name: string): Promise<SessionMedia | null> {
    const dir = path.join(this.dirs().recordings, path.basename(name));
    try {
      const session = JSON.parse(await fs.promises.readFile(path.join(dir, 'session.json'), 'utf8')) as RecordingSession;
      const files: SessionMedia['files'] = {};
      for (const [track, file] of Object.entries(session.files ?? {})) {
        if (typeof file !== 'string') continue;
        const full = path.join(dir, path.basename(file));
        files[track as RecTrack] = { path: full, url: mediaUrl(full) };
      }
      let cursor = null;
      if (session.cursor) {
        cursor = JSON.parse(await fs.promises.readFile(path.join(dir, path.basename(session.cursor)), 'utf8').catch(() => 'null'));
      }
      return { dir: path.basename(dir), session, files, cursor };
    } catch {
      return null;
    }
  }

  private async saveSound(name: unknown, data: unknown): Promise<{ path: string; url: string; name: string } | null> {
    if (typeof name !== 'string' || !/^[a-z]{2,20}$/.test(name) || !(data instanceof Uint8Array) || data.length > 5 * 1024 * 1024) return null;
    if (Buffer.from(data.subarray(0, 4)).toString('ascii') !== 'RIFF') return null;
    const dir = path.join(this.dirs().root, 'Sons');
    await fs.promises.mkdir(dir, { recursive: true });
    const file = path.join(dir, `${name}.wav`);
    if (!fs.existsSync(file)) await fs.promises.writeFile(file, data);
    return { path: file, url: mediaUrl(file), name };
  }

  private async download(rawUrl: unknown, rawName: unknown): Promise<{ path: string; url: string; name: string } | null> {
    if (typeof rawUrl !== 'string') return null;
    let url: URL;
    try {
      url = new URL(rawUrl);
    } catch {
      return null;
    }
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.has(url.hostname)) return null;
    const res = await net.fetch(url.href).catch(() => null);
    if (!res?.ok) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD) return null;
    const dir = this.dirs().imports;
    await fs.promises.mkdir(dir, { recursive: true });
    const name = cleanName(typeof rawName === 'string' ? rawName : '') || path.basename(url.pathname) || 'file';
    const ext = path.extname(name) || path.extname(url.pathname);
    const file = path.join(dir, `${path.basename(name, ext)} ${stamp()}${ext}`);
    await fs.promises.writeFile(file, bytes);
    return { path: file, url: mediaUrl(file), name };
  }
}

function cleanName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 80);
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}
