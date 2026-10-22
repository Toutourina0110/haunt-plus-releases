import fs from 'node:fs';
import path from 'node:path';

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

export function hauntPlusCode(): string | null {
  if (cached === null) {
    try {
      cached = wrap(fs.readFileSync(path.join(__dirname, 'userscripts', 'haunt-plus.user.js'), 'utf8'));
    } catch (err) {
      console.error('haunt+ userscript missing:', err);
      cached = '';
    }
  }
  return cached || null;
}

export function runMenuCommandJs(name: string): string {
  return `(() => {
    const fn = window.__hauntPlusMenu && window.__hauntPlusMenu.get(${JSON.stringify(name)});
    if (typeof fn !== 'function') return false;
    fn();
    return true;
  })()`;
}
