export type SiteId = 'haunt' | 'tools';
export type TabId = SiteId | 'images';
export const TABS: readonly TabId[] = ['haunt', 'tools', 'images'];
export type Locale = 'fr' | 'en' | 'de' | 'pt-BR';
export type LanguageSetting = 'auto' | Locale;
export type AnimationMode = 'full' | 'simple' | 'off';
export type TransitionSpeed = 'fast' | 'medium' | 'long';
export type StartPage = TabId | 'last';
export type LinkTarget = 'popup' | 'browser';
export type LinkKind = 'page' | 'raw';

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface WindowBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface Settings {
  startPage: StartPage;
  lastSite: TabId;
  openAtLogin: boolean;
  closeToTray: boolean;
  animations: AnimationMode;
  transitionSpeed: TransitionSpeed;
  language: LanguageSetting;
  imagehostLink: LinkKind;
  imagehostSaveLocal: boolean;
  imagehostShortcuts: boolean;
  shortcutArea: string;
  shortcutScreen: string;
  shortcutClipboard: string;
  externalLinks: LinkTarget;
  hauntPlus: boolean;
  globalShortcut: boolean;
  trayHintShown: boolean;
  maximized: boolean;
  bounds: WindowBounds | null;
}

export const EDITABLE_KEYS = [
  'startPage',
  'openAtLogin',
  'closeToTray',
  'animations',
  'transitionSpeed',
  'language',
  'imagehostLink',
  'imagehostSaveLocal',
  'imagehostShortcuts',
  'shortcutArea',
  'shortcutScreen',
  'shortcutClipboard',
  'externalLinks',
  'hauntPlus',
  'globalShortcut',
] as const;

export type EditableKey = (typeof EDITABLE_KEYS)[number];
export type SettingsPatch = Partial<Pick<Settings, EditableKey>>;

export interface UiInit {
  role: 'shell' | 'overlay' | 'popup' | 'images';
  locale: Locale;
  dark: boolean;
  site: TabId;
  settings: Settings;
  version: string;
  marks?: Record<TabId, LogoFile>;
  hasKey?: boolean;
  shortcuts?: Record<'shortcutArea' | 'shortcutScreen' | 'shortcutClipboard', boolean>;
}

export interface LogoFile {
  bytes: Uint8Array;
  type: string;
}

export interface ShellState {
  active: TabId;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export interface PopupState {
  source: SiteId;
  title: string;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  loading: boolean;
}

export type UpdateState = 'dev' | 'idle' | 'checking' | 'none' | 'downloading' | 'ready' | 'error';

export interface UpdateStatus {
  state: UpdateState;
  percent?: number;
  version?: string;
}

export interface PageShot {
  jpeg: Uint8Array;
  boxes: Box[];
}

export interface TransitionPayload {
  kind: 'switch' | 'intro';
  mode: 'full' | 'simple';
  duration: number;
  fromSite: TabId | null;
  toSite: TabId;
  from: PageShot | null;
  to: PageShot | null;
}

export interface SettingsOpenPayload {
  snapshot: string | null;
  settings: Settings;
  update: UpdateStatus;
}

export type MenuAction = TabId | 'settings' | 'hauntplus';

export type ImageError =
  | 'NO_KEY'
  | 'UNAUTHORIZED'
  | 'RATE_LIMITED'
  | 'INVALID_MIME'
  | 'QUOTA_EXCEEDED'
  | 'FILE_TOO_LARGE'
  | 'NO_FILE'
  | 'NOT_FOUND'
  | 'NETWORK'
  | 'STORAGE'
  | 'FAILED';

export interface ImageItem {
  id: string;
  name: string;
  originalName: string;
  mime: string;
  type: 'image' | 'video' | 'audio' | 'other';
  size: number;
  url: string | null;
  rawUrl: string | null;
  views: number;
  folder: { id: string; name: string } | null;
  uploadAt: string;
}

export interface ImageFolder {
  id: string;
  name: string;
  fileCount: number;
  totalBytes: number;
  previews: string[];
}

export interface ImageQuery {
  search: string;
  folderId: string;
  type: 'all' | 'image' | 'video';
  sort: 'uploadAt' | 'fileSize' | 'viewCount';
  order: 'asc' | 'desc';
  favoriteOnly: boolean;
  offset: number;
  limit: number;
}

export type ImageListResult = { ok: true; items: ImageItem[]; total: number; offset: number } | { ok: false; error: ImageError };
export type ImageFoldersResult = { ok: true; items: ImageFolder[] } | { ok: false; error: ImageError };

export interface OutgoingFile {
  name: string;
  type: string;
  bytes: Uint8Array;
}

export type UploadOutcome = { ok: true; link: string } | { ok: false; error: ImageError; name: string };

export interface KeyResult {
  hasKey: boolean;
  error?: ImageError;
}

export interface CaptureInit {
  image: string;
  hint: string;
}

export interface CaptureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavAction = 'back' | 'forward' | 'reload';
export type PopupAction = NavAction | 'copy' | 'browser';
