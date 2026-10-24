import { palette } from '../shared/palette';
import { t, type StringKey } from '../shared/i18n';
import type { Locale, TabId } from '../shared/types';
import type { TourLabels } from './tour';

export interface Desk {
  send(channel: string, data?: unknown): void;
  invoke<T>(channel: string, data?: unknown): Promise<T>;
  on<T>(channel: string, callback: (data: T) => void): () => void;
}

declare global {
  interface Window {
    desk: Desk;
  }
}

export const desk = window.desk;

export const LOGOS: Record<TabId, string> = {
  haunt: 'assets/haunt.png',
  tools: 'assets/tools.svg',
  images: 'assets/imagehost.svg',
};

let locale: Locale = 'en';

export function setLocale(next: Locale): void {
  locale = next;
  document.documentElement.lang = next;
}

export function tr(key: StringKey, vars?: Record<string, string | number>): string {
  return t(locale, key, vars);
}

export function siteName(site: TabId): string {
  return tr(site === 'haunt' ? 'siteHaunt' : site === 'tools' ? 'siteTools' : 'siteImages');
}

export function applyPalette(site: TabId, dark: boolean): void {
  const p = palette(site, dark);
  const root = document.documentElement;
  root.dataset.site = site;
  root.dataset.theme = dark ? 'dark' : 'light';
  root.style.setProperty('--bg', p.bg);
  root.style.setProperty('--surface', p.surface);
  root.style.setProperty('--raised', p.raised);
  root.style.setProperty('--line', p.line);
  root.style.setProperty('--fg', p.fg);
  root.style.setProperty('--muted', p.muted);
  root.style.setProperty('--accent', p.accent);
  root.style.setProperty('--on-accent', p.onAccent);
  root.style.colorScheme = dark ? 'dark' : 'light';
}

const stroke = (body: string) =>
  `<svg viewBox="0 0 20 20" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  back: stroke('<path d="M12.5 4.5 7 10l5.5 5.5"/>'),
  forward: stroke('<path d="M7.5 4.5 13 10l-5.5 5.5"/>'),
  reload: stroke('<path d="M15.6 10.4a5.6 5.6 0 1 1-1.7-4.4"/><path d="M15.9 3.2v3.6h-3.6"/>'),
  home: stroke('<path d="M3.5 9.2 10 3.8l6.5 5.4"/><path d="M5.2 8v8.2h9.6V8"/><path d="M8.4 16.2v-4.4h3.2v4.4"/>'),
  link: stroke('<rect x="2.2" y="6.4" width="9.4" height="7.2" rx="3.6"/><rect x="8.4" y="6.4" width="9.4" height="7.2" rx="3.6"/>'),
  check: stroke('<path d="m4.5 10.4 3.6 3.6 7.4-8"/>'),
  edit: stroke('<path d="M12.6 4.4l3 3L7.4 15.6 4 16l.4-3.4z"/><path d="M11 6l3 3"/>'),
  gear: stroke(
    '<path d="M15.91 7.55 L16.18 8.34 L18.05 8.44 L18.05 11.56 L16.18 11.66 L15.91 12.45 L15.54 13.20 L16.80 14.59 L14.59 16.80 L13.20 15.54 L12.45 15.91 L11.66 16.18 L11.56 18.05 L8.44 18.05 L8.34 16.18 L7.55 15.91 L6.80 15.54 L5.41 16.80 L3.20 14.59 L4.46 13.20 L4.09 12.45 L3.82 11.66 L1.95 11.56 L1.95 8.44 L3.82 8.34 L4.09 7.55 L4.46 6.80 L3.20 5.41 L5.41 3.20 L6.80 4.46 L7.55 4.09 L8.34 3.82 L8.44 1.95 L11.56 1.95 L11.66 3.82 L12.45 4.09 L13.20 4.46 L14.59 3.20 L16.80 5.41 L15.54 6.80Z"/><circle cx="10" cy="10" r="2.6"/>',
  ),
  external: stroke(
    '<path d="M11.5 3.5h5v5"/><path d="M16.5 3.5 9.5 10.5"/><path d="M14.5 11.5v3.2a1.8 1.8 0 0 1-1.8 1.8H5.3a1.8 1.8 0 0 1-1.8-1.8V7.3a1.8 1.8 0 0 1 1.8-1.8h3.2"/>',
  ),
  images: stroke('<rect x="2.5" y="3.5" width="15" height="13" rx="2.2"/><circle cx="7.3" cy="8.2" r="1.6"/><path d="m17.2 13.2-3.9-3.9-7.6 7"/>'),
  help: stroke('<circle cx="10" cy="10" r="7.6"/><path d="M8 7.9a2.1 2.1 0 1 1 3 1.9c-.6.3-1 .8-1 1.4v.3"/><path d="M10 13.9v.1"/>'),
  lock: stroke('<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.8a3 3 0 0 1 6 0V9"/>'),
  unlock: stroke('<rect x="4.5" y="9" width="11" height="8" rx="2"/><path d="M7 9V6.8a3 3 0 0 1 5.8-1.1"/>'),
  close: stroke('<path d="M5.5 5.5l9 9M14.5 5.5l-9 9"/>'),
  plus: `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true" focusable="false"><defs><linearGradient id="hp-rainbow" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FF5A8A"/><stop offset=".25" stop-color="#FFB547"/><stop offset=".5" stop-color="#4FD18B"/><stop offset=".75" stop-color="#4AA8FF"/><stop offset="1" stop-color="#B07CFF"/></linearGradient></defs><path fill="url(#hp-rainbow)" d="M8.6 2.6a1.4 1.4 0 0 1 2.8 0v6h6a1.4 1.4 0 0 1 0 2.8h-6v6a1.4 1.4 0 0 1-2.8 0v-6h-6a1.4 1.4 0 0 1 0-2.8h6z"/></svg>`,
} as const;

export function applyFont(name: string): Promise<boolean> {
  if (!name) return Promise.resolve(true);
  document.documentElement.style.setProperty('--app-font', `"${name}", "Average Sans"`);
  const family = encodeURIComponent(name);
  const weights = [':wght@400;500;600;700', ':wght@400;700', ''];
  return new Promise((resolve) => {
    const load = (i: number) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = `https://fonts.googleapis.com/css2?family=${family}${weights[i]}&display=swap`;
      link.addEventListener('load', () => resolve(true));
      link.addEventListener('error', () => {
        link.remove();
        if (i + 1 < weights.length) load(i + 1);
        else resolve(false);
      });
      document.head.append(link);
    };
    load(0);
  });
}

export function tourLabels(): TourLabels {
  return {
    next: tr('tourNext'),
    prev: tr('tourPrev'),
    done: tr('tourDone'),
    skip: tr('tourSkip'),
    count: (i, n) => tr('tourCount', { i, n }),
  };
}

export function iconButton(id: string, icon: keyof typeof ICONS, label: string): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.id = id;
  button.className = 'icon-btn';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = ICONS[icon];
  return button;
}

export function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

export async function paintSettled(): Promise<void> {
  await nextFrame();
  await nextFrame();
}

export function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

export function hostOf(raw: string): string {
  try {
    return new URL(raw).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
