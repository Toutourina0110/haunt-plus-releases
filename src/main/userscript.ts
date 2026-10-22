import { app, net } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const REMOTE = 'https://haunt-tools.site/assets/haunttheme.user.js';
const PUBLIC_KEY = crypto.createPublicKey({
  key: Buffer.from('MCowBQYDK2VwAyEA/eM2aRT8aMs8XyGFQlzW7ZdPH5GCuTQpM8r9KfFuizk=', 'base64'),
  format: 'der',
  type: 'spki',
});
const CHECK_EVERY = 6 * 60 * 60 * 1000;
const MAX_BYTES = 2 * 1024 * 1024;

let cached: string | null = null;

function wrap(source: string): string {
  return [
    '(() => {',
    '  if (window.__hauntPlusMenu) return;',
    '  const menu = new Map();',
    "  Object.defineProperty(window, '__hauntPlusMenu', { value: menu });",
    '  const GM_registerMenuCommand = (name, fn) => { menu.set(String(name), fn); };',
    source,
    '})();',
    '//# sourceURL=haunt-plus.user.js',
  ].join('\n');
}

function normalize(source: string): string {
  return source.replace(/\r\n/g, '\n');
}

function versionOf(source: string): number[] {
  const m = /^\/\/\s*@version\s+(\d+(?:\.\d+)*)\s*$/m.exec(source.slice(0, 4000));
  return m ? m[1].split('.').map(Number) : [];
}

function newer(a: number[], b: number[]): boolean {
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d) return d > 0;
  }
  return false;
}

function signed(source: string, sig: string): boolean {
  try {
    return crypto.verify(null, Buffer.from(source), PUBLIC_KEY, Buffer.from(sig.trim(), 'base64'));
  } catch {
    return false;
  }
}

const downloadFile = () => path.join(app.getPath('userData'), 'userscript', 'haunt-plus.user.js');

function bundled(): string {
  return normalize(fs.readFileSync(path.join(__dirname, 'userscripts', 'haunt-plus.user.js'), 'utf8'));
}

function downloaded(): string | null {
  try {
    const source = normalize(fs.readFileSync(downloadFile(), 'utf8'));
    return signed(source, fs.readFileSync(downloadFile() + '.sig', 'utf8')) ? source : null;
  } catch {
    return null;
  }
}

function inUse(): string {
  let base = '';
  try {
    base = bundled();
  } catch (err) {
    console.error('haunt+ userscript missing:', err);
  }
  const fresh = downloaded();
  return fresh && newer(versionOf(fresh), versionOf(base)) ? fresh : base;
}

export function hauntPlusCode(): string | null {
  if (cached === null) {
    const source = inUse();
    cached = source ? wrap(source) : '';
  }
  return cached || null;
}

async function fetchText(url: string): Promise<string> {
  const res = await net.fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) throw new Error(`${url}: too large`);
  return new TextDecoder().decode(bytes);
}

async function checkForUpdate(): Promise<void> {
  try {
    const [source, sig] = await Promise.all([fetchText(REMOTE).then(normalize), fetchText(`${REMOTE}.sig`)]);
    if (!newer(versionOf(source), versionOf(inUse()))) return;
    if (!signed(source, sig)) {
      console.warn('haunt+ userscript: the published version has no valid signature, ignored');
      return;
    }
    fs.mkdirSync(path.dirname(downloadFile()), { recursive: true });
    fs.writeFileSync(downloadFile() + '.sig', sig);
    fs.writeFileSync(downloadFile(), source);
    cached = null;
  } catch (err) {
    console.warn('haunt+ userscript update check failed:', err instanceof Error ? err.message : err);
  }
}

export function watchUserscript(): void {
  void checkForUpdate();
  setInterval(() => void checkForUpdate(), CHECK_EVERY);
}

export function runMenuCommandJs(name: string): string {
  return `(() => {
    const fn = window.__hauntPlusMenu && window.__hauntPlusMenu.get(${JSON.stringify(name)});
    if (typeof fn !== 'function') return false;
    fn();
    return true;
  })()`;
}
