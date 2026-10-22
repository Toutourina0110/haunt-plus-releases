import { app } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SHORTCUTS, isValidShortcut } from '../shared/shortcuts';
import { EDITABLE_KEYS, type Settings, type SettingsPatch, type WindowBounds } from '../shared/types';

const DEFAULTS: Settings = {
  startPage: 'last',
  lastSite: 'haunt',
  openAtLogin: false,
  closeToTray: true,
  animations: 'full',
  transitionSpeed: 'medium',
  language: 'auto',
  imagehostLink: 'page',
  imagehostSaveLocal: false,
  imagehostShortcuts: true,
  ...DEFAULT_SHORTCUTS,
  externalLinks: 'popup',
  hauntPlus: true,
  globalShortcut: true,
  trayHintShown: false,
  maximized: false,
  bounds: null,
};

const ENUMS: Partial<Record<keyof Settings, readonly string[]>> = {
  startPage: ['haunt', 'tools', 'images', 'last'],
  lastSite: ['haunt', 'tools', 'images'],
  animations: ['full', 'simple', 'off'],
  transitionSpeed: ['fast', 'medium', 'long'],
  language: ['auto', 'fr', 'en', 'de', 'pt-BR'],
  imagehostLink: ['page', 'raw'],
  externalLinks: ['popup', 'browser'],
};

const BOOLEANS: Array<keyof Settings> = [
  'openAtLogin',
  'closeToTray',
  'hauntPlus',
  'globalShortcut',
  'trayHintShown',
  'maximized',
  'imagehostSaveLocal',
  'imagehostShortcuts',
];

function isBounds(v: unknown): v is WindowBounds {
  if (!v || typeof v !== 'object') return false;
  const b = v as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((k) => typeof b[k] === 'number' && Number.isFinite(b[k] as number));
}

function clean(input: unknown, allowed: readonly (keyof Settings)[]): Partial<Settings> {
  if (!input || typeof input !== 'object') return {};
  const src = input as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const key of allowed) {
    if (!(key in src)) continue;
    const value = src[key];
    const options = ENUMS[key];
    if (options) {
      if (typeof value === 'string' && options.includes(value)) out[key] = value;
    } else if (BOOLEANS.includes(key)) {
      if (typeof value === 'boolean') out[key] = value;
    } else if (key === 'shortcutArea' || key === 'shortcutScreen' || key === 'shortcutClipboard') {
      if (isValidShortcut(value)) out[key] = value;
    } else if (key === 'bounds') {
      if (value === null || isBounds(value)) out[key] = value;
    }
  }
  return out as Partial<Settings>;
}

export function cleanPatch(input: unknown): SettingsPatch {
  return clean(input, EDITABLE_KEYS) as SettingsPatch;
}

export class SettingsStore {
  private readonly file = path.join(app.getPath('userData'), 'settings.json');
  private data: Settings;
  private timer: NodeJS.Timeout | null = null;

  constructor() {
    this.data = { ...DEFAULTS, ...this.read() };
  }

  get(): Settings {
    return { ...this.data };
  }

  value<K extends keyof Settings>(key: K): Settings[K] {
    return this.data[key];
  }

  update(patch: Partial<Settings>): void {
    this.data = { ...this.data, ...patch };
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), 400);
  }

  flush(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save settings:', err);
    }
  }

  private read(): Partial<Settings> {
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return clean(raw, Object.keys(DEFAULTS) as Array<keyof Settings>);
    } catch {
      return {};
    }
  }
}
