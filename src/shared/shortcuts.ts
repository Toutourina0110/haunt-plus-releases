export const SHORTCUT_KEYS = ['shortcutArea', 'shortcutScreen', 'shortcutClipboard', 'shortcutRecordArea', 'shortcutRecordScreen', 'shortcutReplay'] as const;
export type ShortcutKey = (typeof SHORTCUT_KEYS)[number];
export type ShortcutStatus = Record<ShortcutKey, boolean>;

export const DEFAULT_SHORTCUTS: Record<ShortcutKey, string> = {
  shortcutArea: 'Control+Alt+S',
  shortcutScreen: 'Control+Alt+D',
  shortcutClipboard: 'Control+Alt+U',
  shortcutRecordArea: 'Control+Alt+R',
  shortcutRecordScreen: 'Control+Alt+E',
  shortcutReplay: 'Control+Alt+C',
};

export const RESERVED_SHORTCUTS = ['Control+Alt+H', 'Control+Shift+F'];

const MODIFIERS = ['Control', 'Alt', 'Shift', 'Super'];
const KEY = /^([A-Z0-9]|F([1-9]|1\d|2[0-4])|PrintScreen|Space|Insert|Home|End|PageUp|PageDown|Up|Down|Left|Right)$/;
const LONE = /^(PrintScreen|F([1-9]|1\d|2[0-4]))$/;

export function isValidShortcut(acc: unknown): acc is string {
  if (typeof acc !== 'string' || acc.length > 60) return false;
  const parts = acc.split('+');
  const key = parts.pop() ?? '';
  if (!KEY.test(key)) return false;
  if (parts.some((p) => !MODIFIERS.includes(p)) || new Set(parts).size !== parts.length) return false;
  if (parts.join('+') !== MODIFIERS.filter((m) => parts.includes(m)).join('+')) return false;
  if (RESERVED_SHORTCUTS.includes(acc)) return false;
  if (parts.length >= 2) return true;
  if (key === 'PrintScreen') return true;
  return parts.length === 1 && LONE.test(key);
}

const CODES: Record<string, string> = {
  Space: 'Space',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  PrintScreen: 'PrintScreen',
};

export function shortcutFromEvent(e: { ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean; code: string }): string | null {
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit\d$/.test(e.code)) key = e.code.slice(5);
  else if (/^F\d{1,2}$/.test(e.code)) key = e.code;
  else key = CODES[e.code] ?? null;
  if (!key) return null;
  const mods = [e.ctrlKey && 'Control', e.altKey && 'Alt', e.shiftKey && 'Shift', e.metaKey && 'Super'].filter(Boolean);
  return [...mods, key].join('+');
}

const KEY_NAMES: Record<string, Record<string, string>> = {
  fr: { Control: 'Ctrl', Shift: 'Maj', PrintScreen: 'Impr. écran', Space: 'Espace', Home: 'Début' },
  de: { Control: 'Strg', Shift: 'Umschalt', PrintScreen: 'Druck', Space: 'Leertaste', Home: 'Pos1' },
  'pt-BR': { Control: 'Ctrl', Shift: 'Shift', PrintScreen: 'Print Screen', Space: 'Espaço', Home: 'Home' },
  en: { Control: 'Ctrl', Shift: 'Shift', PrintScreen: 'Print Screen', Space: 'Space' },
};
const SAME_EVERYWHERE: Record<string, string> = { Super: 'Win', Up: '↑', Down: '↓', Left: '←', Right: '→' };

export function keyLabel(name: string, locale: string): string {
  return (KEY_NAMES[locale] ?? KEY_NAMES.en)[name] ?? SAME_EVERYWHERE[name] ?? name;
}

export function shortcutLabels(acc: string, locale: string): string[] {
  return acc.split('+').map((part) => keyLabel(part, locale));
}
