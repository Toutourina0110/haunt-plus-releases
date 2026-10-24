import type { SHORTCUT_KEYS } from './shortcuts';

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
  font: string;
  imagehostLink: LinkKind;
  imagehostSaveLocal: boolean;
  imagehostEditAfterCapture: boolean;
  imagehostShortcuts: boolean;
  shortcutArea: string;
  shortcutScreen: string;
  shortcutClipboard: string;
  shortcutRecordArea: string;
  shortcutRecordScreen: string;
  recordFps: 30 | 60;
  recordSystemAudio: boolean;
  recordMic: string;
  recordWebcam: string;
  recordCursor: boolean;
  recordClicks: boolean;
  recordAutoZoom: boolean;
  videoFolder: string;
  tourAppSeen: boolean;
  tourImagesSeen: boolean;
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
  'font',
  'imagehostLink',
  'imagehostSaveLocal',
  'imagehostEditAfterCapture',
  'imagehostShortcuts',
  'shortcutArea',
  'shortcutScreen',
  'shortcutClipboard',
  'shortcutRecordArea',
  'shortcutRecordScreen',
  'recordFps',
  'recordSystemAudio',
  'recordMic',
  'recordWebcam',
  'recordCursor',
  'recordClicks',
  'recordAutoZoom',
  'tourAppSeen',
  'tourImagesSeen',
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
  shortcuts?: Record<(typeof SHORTCUT_KEYS)[number], boolean>;
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

export interface UpdateNoticePayload {
  version: string;
  message: string;
  update: UpdateStatus;
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

export interface TourStartPayload {
  rects: Record<'switch' | 'nav' | 'copy' | 'help', Box | null>;
  titlebar: Box | null;
  active: TabId;
  hauntPlus: boolean;
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

export interface AnnotateInit {
  image: string | null;
  locale: Locale;
  dark: boolean;
  font: string;
  hasKey: boolean;
}

export type AnnotateAction = 'upload' | 'save' | 'copy';
export type AnnotateResult = { ok: true; link?: string } | { ok: false; error?: ImageError };

export type AnnotateSource = { kind: 'blank' } | { kind: 'url'; url: string };

export type CaptureAction = 'annotate' | 'upload' | 'copy' | 'save';
export type PickAction = CaptureAction | 'record';

export interface CaptureInit {
  image: string;
  hint: string;
  font: string;
  mode: 'shot' | 'video' | 'screen';
  labels: Record<PickAction | 'cancel', string>;
  screens?: { here: string; all: string };
  origin: { x: number; y: number };
}

export interface CapturePick {
  action: PickAction;
  whole?: boolean;
  all?: boolean;
}

export interface CaptureDown {
  mode: 'draw' | 'move' | 'resize';
  handle?: string;
}

export interface CaptureSync {
  rect: CaptureRect | null;
  chosen: boolean;
  bar: boolean;
}

export interface CaptureRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type NavAction = 'back' | 'forward' | 'reload' | 'home';
export type PopupAction = Exclude<NavAction, 'home'> | 'copy' | 'browser';

export type RecordKind = 'area' | 'screen';
export type RecTrack = 'screen' | 'mic' | 'webcam';
export type RecCommand = 'pause' | 'resume' | 'stop' | 'cancel';

export interface NormRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface RecorderInit {
  fps: 30 | 60;
  cursor: boolean;
  systemAudio: boolean;
  micId: string;
  webcamId: string;
  layout?: RecLayout;
}

export interface RecLayout {
  width: number;
  height: number;
  screens: Array<{ x: number; y: number; w: number; h: number }>;
}

export interface RecStarted {
  mimes: Partial<Record<RecTrack, string>>;
  offsets: Partial<Record<RecTrack, number>>;
  noSystemAudio?: boolean;
  startedAt?: number;
}

export interface RecBarInit {
  locale: Locale;
  font: string;
}

export interface RecBarState {
  paused: boolean;
  elapsed: number;
}

export interface RecordingSession {
  version: 1;
  created: string;
  fps: number;
  display: { width: number; height: number; scale: number };
  area: NormRect | null;
  files: Partial<Record<RecTrack, string>>;
  offsets: Partial<Record<RecTrack, number>>;
  duration: number;
  cursor: string | null;
}

export interface CursorLog {
  samples: number[];
  clicks: number[];
}

export interface MediaItem {
  id: string;
  path: string;
  url: string;
  name: string;
  kind: 'video' | 'audio' | 'image';
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
  crop: NormRect | null;
  session: string | null;
  clicks?: number[];
  cursor?: number[];
}

export type ClipType = 'media' | 'text' | 'shape' | 'effect';
export type AnimProp = 'x' | 'y' | 'scale' | 'rotation' | 'opacity' | 'volume' | 'brightness' | 'contrast' | 'saturation' | 'grayscale';
export type Ease = 'linear' | 'smooth' | 'in' | 'out' | 'hold';

export interface Keyframe {
  t: number;
  v: number;
  ease: Ease;
}

export type TransitionKind = 'none' | 'fade' | 'slide-left' | 'slide-right' | 'slide-up' | 'slide-down' | 'zoom';

export interface ClipTransition {
  kind: TransitionKind;
  duration: number;
}

export interface ZoomSegment {
  t: number;
  d: number;
  x: number;
  y: number;
  scale: number;
  follow?: boolean;
}

export interface TextStyle {
  content: string;
  size: number;
  color: string;
  background: string | null;
  bold: boolean;
  align: 'left' | 'center' | 'right';
}

export interface ShapeStyle {
  kind: 'rect' | 'ellipse' | 'arrow';
  color: string;
  width: number;
  fill: boolean;
}

export interface EffectStyle {
  kind: 'blur' | 'pixel';
  strength: number;
}

export interface FrameStyle {
  padding: number;
  radius: number;
  shadow: boolean;
}

export interface ClipFilters {
  brightness: number;
  contrast: number;
  saturation: number;
  grayscale: number;
}

export interface Clip {
  id: string;
  mediaId: string;
  start: number;
  in: number;
  out: number;
  speed: number;
  volume: number;
  fit: 'contain' | 'cover' | 'fill';
  x: number;
  y: number;
  scale: number;
  opacity: number;
  type?: ClipType;
  rotation?: number;
  w?: number;
  h?: number;
  keyframes?: Partial<Record<AnimProp, Keyframe[]>>;
  filters?: ClipFilters;
  fadeIn?: number;
  fadeOut?: number;
  enter?: ClipTransition;
  exit?: ClipTransition;
  mask?: 'none' | 'circle' | 'rounded';
  frame?: FrameStyle | null;
  zooms?: ZoomSegment[];
  clicks?: boolean;
  text?: TextStyle;
  shape?: ShapeStyle;
  effect?: EffectStyle;
}

export interface Track {
  id: string;
  kind: 'video' | 'audio';
  clips: Clip[];
  muted: boolean;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  created: string;
  updated: string;
  width: number;
  height: number;
  fps: 30 | 60;
  background: string;
  background2?: string | null;
  media: MediaItem[];
  tracks: Track[];
}

export interface ProjectSummary {
  id: string;
  name: string;
  updated: string;
}

export interface RecordingSummary {
  dir: string;
  created: string;
  duration: number;
}

export interface SessionMedia {
  dir: string;
  session: RecordingSession;
  files: Partial<Record<RecTrack, { path: string; url: string }>>;
  cursor: CursorLog | null;
}

export interface VideoInit {
  locale: Locale;
  dark: boolean;
  font: string;
  hasKey: boolean;
  project: Project | null;
  recording: SessionMedia | null;
  recent: ProjectSummary[];
  autoZoom: boolean;
}

export type VideoOutputAction = 'upload' | 'save' | 'copy' | 'folder';
