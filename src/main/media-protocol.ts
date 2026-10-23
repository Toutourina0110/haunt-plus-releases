import { app, protocol } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Readable } from 'node:stream';

export const MEDIA_SCHEME = 'haunt-media';

const TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.flac': 'audio/flac',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
};

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-length, content-range, accept-ranges' };

export const MEDIA_EXTENSIONS = Object.keys(TYPES).map((e) => e.slice(1));

export function registerMediaScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ]);
}

export function mediaUrl(file: string): string {
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(file)}`;
}

export function mediaType(file: string): string | null {
  return TYPES[path.extname(file).toLowerCase()] ?? null;
}

export class MediaGrants {
  private readonly file = path.join(app.getPath('userData'), 'media-grants.json');
  private readonly granted = new Set<string>();

  constructor(private readonly root: () => string) {
    try {
      for (const p of JSON.parse(fs.readFileSync(this.file, 'utf8')) as unknown[]) if (typeof p === 'string') this.granted.add(p);
    } catch {
    }
  }

  grant(file: string): void {
    const full = path.resolve(file);
    if (this.granted.has(full)) return;
    this.granted.add(full);
    fs.promises.writeFile(this.file, JSON.stringify([...this.granted])).catch(() => {});
  }

  allowed(file: string): boolean {
    const full = path.resolve(file);
    if (!mediaType(full)) return false;
    const root = path.resolve(this.root()) + path.sep;
    return full.startsWith(root) || this.granted.has(full);
  }
}

export function setupMediaProtocol(grants: MediaGrants): void {
  protocol.handle(MEDIA_SCHEME, async (request) => {
    const url = new URL(request.url);
    const file = decodeURIComponent(url.pathname.slice(1));
    if (url.hostname !== 'file' || !path.isAbsolute(file) || !grants.allowed(file)) return new Response(null, { status: 403 });
    let size: number;
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile()) return new Response(null, { status: 404 });
      size = stat.size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const type = mediaType(file) ?? 'application/octet-stream';
    const range = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get('range') ?? '');
    if (!range || size === 0) {
      const body = Readable.toWeb(fs.createReadStream(file)) as ReadableStream;
      return new Response(body, { status: 200, headers: { ...CORS, 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
    }
    let start = range[1] ? Number(range[1]) : size - Number(range[2]);
    let end = range[1] && range[2] ? Number(range[2]) : size - 1;
    start = Math.max(0, start);
    end = Math.min(size - 1, end);
    if (start > end) return new Response(null, { status: 416, headers: { 'content-range': `bytes */${size}` } });
    const body = Readable.toWeb(fs.createReadStream(file, { start, end })) as ReadableStream;
    return new Response(body, {
      status: 206,
      headers: {
        ...CORS,
        'content-type': type,
        'content-length': String(end - start + 1),
        'content-range': `bytes ${start}-${end}/${size}`,
        'accept-ranges': 'bytes',
      },
    });
  });
}
