import { app, clipboard, nativeImage, net, Notification, safeStorage, type NativeImage } from 'electron';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { IMAGE_ERRORS, t } from '../shared/i18n';
import type {
  ImageError,
  ImageFolder,
  ImageFoldersResult,
  ImageItem,
  ImageListResult,
  ImageQuery,
  KeyResult,
  Locale,
  UploadOutcome,
} from '../shared/types';
import { captureArea, captureScreen } from './capture';
import type { SettingsStore } from './settings';
import { assetFile } from './util';

const API = 'https://haunt.gg/api/imagehost';
const MAX_FILES = 20;
const MAX_BYTES = 250 * 1024 * 1024;
const TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  avif: 'image/avif',
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
};
const MIMES = new Set(Object.values(TYPES));
const SERVER_CODES = new Set<ImageError>(['NO_FILE', 'INVALID_MIME', 'QUOTA_EXCEEDED', 'FILE_TOO_LARGE', 'RATE_LIMITED']);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class ApiError extends Error {
  constructor(readonly code: ImageError) {
    super(code);
  }
}

const codeOf = (err: unknown): ImageError => (err instanceof ApiError ? err.code : 'FAILED');

interface Outgoing {
  name: string;
  mime: string;
  data: Buffer;
}

export interface ImageHostDeps {
  locale: () => Locale;
  settings: SettingsStore;
  onUploaded: () => void;
  openImages: () => void;
}

export class ImageHost {
  private key: string | null | undefined;
  private readonly keyFile = path.join(app.getPath('userData'), 'imagehost.key');
  private readonly shown = new Set<Notification>();
  private capturing = false;

  constructor(private readonly deps: ImageHostDeps) {}

  hasKey(): boolean {
    return !!this.readKey();
  }

  private readKey(): string | null {
    if (this.key !== undefined) return this.key;
    try {
      this.key = safeStorage.decryptString(fs.readFileSync(this.keyFile));
    } catch {
      this.key = null;
    }
    return this.key;
  }

  async setKey(raw: unknown): Promise<KeyResult> {
    if (raw === null) {
      fs.rmSync(this.keyFile, { force: true });
      this.key = null;
      return { hasKey: false };
    }
    const key = typeof raw === 'string' ? raw.trim() : '';
    if (!/^[\x21-\x7e]{8,256}$/.test(key)) return { hasKey: this.hasKey(), error: 'UNAUTHORIZED' };
    if (!safeStorage.isEncryptionAvailable()) return { hasKey: this.hasKey(), error: 'STORAGE' };
    try {
      await this.request('/uploads?limit=1', {}, key);
    } catch (err) {
      return { hasKey: this.hasKey(), error: codeOf(err) };
    }
    fs.mkdirSync(path.dirname(this.keyFile), { recursive: true });
    fs.writeFileSync(this.keyFile, safeStorage.encryptString(key));
    this.key = key;
    return { hasKey: true };
  }

  private async request(route: string, init: { method?: string; body?: Blob; type?: string } = {}, key = this.readKey()): Promise<unknown> {
    if (!key) throw new ApiError('NO_KEY');
    const headers = new Headers({ 'X-API-Key': key, Accept: 'application/json' });
    if (init.type) headers.set('Content-Type', init.type);
    let res: Response;
    try {
      res = await net.fetch(API + route, { method: init.method ?? 'GET', headers, body: init.body });
    } catch {
      throw new ApiError('NETWORK');
    }
    let body: unknown = null;
    try {
      body = await res.json();
    } catch {
      body = null;
    }
    if (res.ok) return body;
    const code = (body as { code?: unknown } | null)?.code;
    if (res.status === 401) throw new ApiError('UNAUTHORIZED');
    if (res.status === 429) throw new ApiError('RATE_LIMITED');
    if (res.status === 413) throw new ApiError('FILE_TOO_LARGE');
    if (res.status === 404) throw new ApiError('NOT_FOUND');
    if (typeof code === 'string' && SERVER_CODES.has(code as ImageError)) throw new ApiError(code as ImageError);
    throw new ApiError('FAILED');
  }

  async list(raw: unknown): Promise<ImageListResult> {
    const q = cleanQuery(raw);
    const params = new URLSearchParams({
      limit: String(q.limit),
      offset: String(q.offset),
      type: q.type,
      folderId: q.folderId,
      sort: q.sort,
      order: q.order,
    });
    if (q.search) params.set('search', q.search);
    if (q.favoriteOnly) params.set('favoriteOnly', 'true');
    try {
      const body = (await this.request(`/uploads?${params}`)) as Record<string, unknown> | null;
      const items = Array.isArray(body?.items) ? body.items.map(cleanItem).filter((i): i is ImageItem => !!i) : [];
      return { ok: true, items, total: count(body?.total), offset: q.offset };
    } catch (err) {
      return { ok: false, error: codeOf(err) };
    }
  }

  async folders(): Promise<ImageFoldersResult> {
    try {
      const body = (await this.request('/folders?limit=100&sort=name&order=asc')) as Record<string, unknown> | null;
      const items: ImageFolder[] = [];
      for (const f of Array.isArray(body?.items) ? body.items : []) {
        const folder = f as Record<string, unknown>;
        if (typeof folder.id === 'string' && UUID.test(folder.id) && typeof folder.name === 'string') {
          const previews = (Array.isArray(folder.previews) ? folder.previews : [])
            .map((p) => httpsUrl((p as Record<string, unknown> | null)?.rawUrl))
            .filter((u): u is string => !!u)
            .slice(0, 4);
          items.push({
            id: folder.id,
            name: folder.name.slice(0, 120),
            fileCount: count(folder.fileCount),
            totalBytes: count(folder.totalBytes),
            previews,
          });
        }
      }
      return { ok: true, items };
    } catch (err) {
      return { ok: false, error: codeOf(err) };
    }
  }

  async uploadFiles(raw: unknown): Promise<UploadOutcome[]> {
    const files: Outgoing[] = [];
    for (const item of Array.isArray(raw) ? raw.slice(0, MAX_FILES) : []) {
      const f = item as Record<string, unknown>;
      if (!(f?.bytes instanceof Uint8Array) || typeof f.name !== 'string') continue;
      const name = f.name.slice(0, 200);
      files.push({ name, mime: mimeOf(name, typeof f.type === 'string' ? f.type : ''), data: Buffer.from(f.bytes) });
    }
    if (!files.length) return [];
    return this.send(files, null);
  }

  async captureArea(): Promise<void> {
    await this.capture(() => captureArea(t(this.deps.locale(), 'captureHint'), this.deps.settings.value('font')));
  }

  async captureScreen(): Promise<void> {
    await this.capture(captureScreen);
  }

  async uploadClipboard(): Promise<void> {
    if (!this.hasKey()) return this.notifyError('NO_KEY');
    const png = await clipboardPng();
    if (png) {
      await this.send([{ name: `haunt-${stamp()}.png`, mime: 'image/png', data: png }], nativeImage.createFromBuffer(png));
      return;
    }
    const file = await clipboardFile();
    if (!file) return this.notifyError('NO_FILE');
    try {
      const data = await fs.promises.readFile(file);
      await this.send([{ name: path.basename(file), mime: mimeOf(file, ''), data }], null);
    } catch {
      this.notifyError('NO_FILE');
    }
  }

  private async capture(take: () => Promise<NativeImage | null>): Promise<void> {
    if (this.capturing) return;
    if (!this.hasKey()) return this.notifyError('NO_KEY');
    this.capturing = true;
    try {
      const image = await take();
      if (!image) return;
      const data = image.toPNG();
      const name = `haunt-${stamp()}.png`;
      if (this.deps.settings.value('imagehostSaveLocal')) {
        const dir = path.join(app.getPath('pictures'), 'haunt+');
        await fs.promises.mkdir(dir, { recursive: true });
        await fs.promises.writeFile(path.join(dir, name), data);
      }
      await this.send([{ name, mime: 'image/png', data }], image);
    } catch (err) {
      console.error('Screenshot failed:', err);
    } finally {
      this.capturing = false;
    }
  }

  private async send(files: Outgoing[], preview: NativeImage | null): Promise<UploadOutcome[]> {
    const outcomes: UploadOutcome[] = [];
    for (const file of files) {
      try {
        outcomes.push({ ok: true, link: await this.uploadOne(file) });
      } catch (err) {
        outcomes.push({ ok: false, error: codeOf(err), name: file.name });
      }
    }
    const links = outcomes.flatMap((o) => (o.ok ? [o.link] : []));
    if (links.length) {
      void clipboard.writeText(links.join('\n'));
      this.deps.onUploaded();
    }
    this.notify(outcomes, preview);
    return outcomes;
  }

  private async uploadOne(file: Outgoing): Promise<string> {
    if (!file.data.length) throw new ApiError('NO_FILE');
    if (!MIMES.has(file.mime)) throw new ApiError('INVALID_MIME');
    if (file.data.length > MAX_BYTES) throw new ApiError('FILE_TOO_LARGE');

    const boundary = `----hauntplus${randomUUID()}`;
    const filename = file.name.replace(/["\\\r\n]/g, '_') || 'file';
    const head = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${file.mime}\r\n\r\n`;
    const body = new Blob([head, file.data as BlobPart, `\r\n--${boundary}--\r\n`]);
    const res = (await this.request('/upload', { method: 'POST', body, type: `multipart/form-data; boundary=${boundary}` })) as Record<string, unknown> | null;

    const page = httpsUrl(res?.url);
    if (this.deps.settings.value('imagehostLink') === 'raw' && typeof res?.id === 'string') {
      try {
        const item = cleanItem(await this.request(`/uploads/${encodeURIComponent(res.id)}`));
        if (item?.rawUrl) return item.rawUrl;
      } catch {
      }
    }
    if (!page) throw new ApiError('FAILED');
    return page;
  }

  private notify(outcomes: UploadOutcome[], preview: NativeImage | null): void {
    const done = outcomes.flatMap((o) => (o.ok ? [o.link] : []));
    const failed = outcomes.flatMap((o) => (o.ok ? [] : [o]));
    const locale = this.deps.locale();
    if (done.length) {
      const title = done.length === 1 ? t(locale, 'uploadDone') : t(locale, 'uploadDoneMany', { n: done.length });
      const body = failed.length ? `${t(locale, 'uploadFailed')} : ${failed.map((f) => f.name).join(', ')}` : done[0];
      this.show(title, body, preview);
    } else if (failed.length) {
      this.notifyError(failed[0].error);
    }
  }

  notifyError(code: ImageError): void {
    this.show(t(this.deps.locale(), 'uploadFailed'), t(this.deps.locale(), IMAGE_ERRORS[code]), null);
  }

  private show(title: string, body: string, preview: NativeImage | null): void {
    if (!Notification.isSupported()) return;
    const icon = preview && !preview.isEmpty() ? preview.resize({ width: 256 }) : assetFile('icon-tools.png');
    const note = new Notification({ title, body, icon });
    this.shown.add(note);
    note.on('click', () => this.deps.openImages());
    note.on('close', () => this.shown.delete(note));
    note.show();
  }
}

function cleanQuery(raw: unknown): ImageQuery {
  const q = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const folderId = typeof q.folderId === 'string' && (q.folderId === 'none' || UUID.test(q.folderId)) ? q.folderId : 'all';
  const type = q.type === 'image' || q.type === 'video' ? q.type : 'all';
  const offset = typeof q.offset === 'number' && Number.isInteger(q.offset) && q.offset >= 0 ? Math.min(q.offset, 1_000_000) : 0;
  const limit = typeof q.limit === 'number' && Number.isInteger(q.limit) ? Math.min(100, Math.max(1, q.limit)) : 40;
  const search = typeof q.search === 'string' ? q.search.trim().slice(0, 100) : '';
  const sort = q.sort === 'fileSize' || q.sort === 'viewCount' ? q.sort : 'uploadAt';
  const order = q.order === 'asc' ? 'asc' : 'desc';
  return { search, folderId, type, sort, order, favoriteOnly: q.favoriteOnly === true, offset, limit };
}

function cleanItem(raw: unknown): ImageItem | null {
  const v = (raw && typeof raw === 'object' ? raw : null) as Record<string, unknown> | null;
  if (!v || typeof v.id !== 'string' || typeof v.name !== 'string') return null;
  const folder = v.folder as Record<string, unknown> | null;
  const type = v.type === 'image' || v.type === 'video' || v.type === 'audio' ? v.type : 'other';
  return {
    id: v.id.slice(0, 128),
    name: v.name.slice(0, 200),
    originalName: typeof v.originalName === 'string' ? v.originalName.slice(0, 200) : v.name.slice(0, 200),
    mime: typeof v.mime === 'string' ? v.mime.slice(0, 100) : '',
    type,
    size: count(v.size),
    url: httpsUrl(v.url),
    rawUrl: httpsUrl(v.rawUrl),
    views: count(v.views),
    folder:
      folder && typeof folder.id === 'string' && typeof folder.name === 'string'
        ? { id: folder.id.slice(0, 64), name: folder.name.slice(0, 120) }
        : null,
    uploadAt: typeof v.uploadAt === 'string' ? v.uploadAt.slice(0, 40) : '',
  };
}

function httpsUrl(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  try {
    return new URL(v).protocol === 'https:' ? v : null;
  } catch {
    return null;
  }
}

function count(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? Math.floor(v) : 0;
}

function mimeOf(name: string, declared: string): string {
  if (MIMES.has(declared)) return declared;
  return TYPES[path.extname(name).slice(1).toLowerCase()] ?? declared;
}

function stamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
}

async function clipboardPng(): Promise<Buffer | null> {
  for (const item of await clipboard.read().catch(() => [])) {
    if (!item.types.includes('image/png')) continue;
    const blob = await item.getType('image/png').catch(() => null);
    if (blob) return Buffer.from(await blob.arrayBuffer());
  }
  return null;
}

async function clipboardFile(): Promise<string | null> {
  if (process.platform !== 'win32') return null;
  for (const item of await clipboard.read().catch(() => [])) {
    const type = item.types.find((t) => t.includes('FileNameW'));
    if (!type) continue;
    const blob = await item.getType(type).catch(() => null);
    if (!(blob instanceof Blob)) continue;
    const file = Buffer.from(await blob.arrayBuffer()).toString('utf16le').split('\0')[0];
    try {
      if (file && fs.statSync(file).isFile()) return file;
    } catch {
    }
  }
  return null;
}
