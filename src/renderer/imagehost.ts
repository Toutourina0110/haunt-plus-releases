import { CH } from '../shared/channels';
import { IMAGE_ERRORS, type StringKey } from '../shared/i18n';
import {
  DEFAULT_SHORTCUTS,
  isValidShortcut,
  SHORTCUT_KEYS,
  shortcutFromEvent,
  shortcutLabels,
  type ShortcutKey,
  type ShortcutStatus,
} from '../shared/shortcuts';
import type {
  ImageError,
  ImageFolder,
  ImageFoldersResult,
  ImageItem,
  ImageListResult,
  ImageQuery,
  KeyResult,
  OutgoingFile,
  Settings,
  SettingsPatch,
  UiInit,
  UploadOutcome,
} from '../shared/types';
import { desk, setLocale, tr } from './common';
import { icon, type IconName } from './hicons';

type Section = 'overview' | 'gallery' | 'folders' | 'capture' | 'settings';
type Kid = Node | string | null | false | undefined;

const SECTIONS: Array<[Section, StringKey, IconName]> = [
  ['overview', 'ihNavOverview', 'overview'],
  ['gallery', 'ihNavGallery', 'image'],
  ['folders', 'ihNavFolders', 'folder'],
  ['capture', 'ihNavCapture', 'camera'],
  ['settings', 'ihNavSettings', 'gear'],
];
const BASE_QUERY: ImageQuery = {
  search: '',
  folderId: 'all',
  type: 'all',
  sort: 'uploadAt',
  order: 'desc',
  favoriteOnly: false,
  offset: 0,
  limit: 40,
};
const SORTS: Array<[string, StringKey, Pick<ImageQuery, 'sort' | 'order'>]> = [
  ['newest', 'ihSortNewest', { sort: 'uploadAt', order: 'desc' }],
  ['oldest', 'ihSortOldest', { sort: 'uploadAt', order: 'asc' }],
  ['largest', 'ihSortLargest', { sort: 'fileSize', order: 'desc' }],
  ['views', 'ihSortViews', { sort: 'viewCount', order: 'desc' }],
];
const STATS_TTL = 60_000;
const SHORTCUT_ROWS: Array<[ShortcutKey, StringKey]> = [
  ['shortcutArea', 'scCaptureRegion'],
  ['shortcutScreen', 'scCaptureScreen'],
  ['shortcutClipboard', 'scUploadClipboard'],
];

const byId = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const content = byId('content');
const nav = byId('nav');
const crumbs = byId('crumbs');
const topActions = byId('top-actions');
const keyCard = byId<HTMLButtonElement>('key-card');
const veil = byId('veil');
const toastEl = byId('toast');
const fileInput = byId<HTMLInputElement>('file');

let settings: Settings;
let hasKey = false;
let section: Section = 'overview';
let renderSeq = 0;
let toastTimer = 0;
let folders: ImageFolder[] | null = null;
let shortcutStatus: ShortcutStatus | null = null;
let recording: ShortcutKey | null = null;
let shortcutNote: { key: ShortcutKey; text: string; bad: boolean } | null = null;
let viewer: { list: ImageItem[]; index: number; el: HTMLElement; back: HTMLElement | null } | null = null;
let stats: { files: number; images: number; videos: number; folders: number; recent: ImageItem[]; at: number } | null = null;
const gallery = {
  query: { ...BASE_QUERY },
  items: [] as ImageItem[],
  total: 0,
  loading: false,
  error: null as ImageError | null,
  seq: 0,
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Kid[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs)) {
    if (name === 'class') el.className = value;
    else el.setAttribute(name, value);
  }
  for (const kid of kids) if (kid) el.append(kid);
  return el;
}

function svg(name: IconName, size = 16): SVGElement {
  const t = document.createElement('template');
  t.innerHTML = icon(name, size);
  return t.content.firstElementChild as SVGElement;
}

function button(cls: string, label: string, onClick: () => void, iconName?: IconName): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls }, iconName ? svg(iconName) : null, label);
  b.addEventListener('click', onClick);
  return b;
}

function iconButton(cls: string, label: string, iconName: IconName, onClick: () => void, size = 16): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, title: label, 'aria-label': label }, svg(iconName, size));
  b.addEventListener('click', onClick);
  return b;
}

function pageHead(title: StringKey, sub: StringKey): HTMLElement {
  return h('div', { class: 'page-head' }, h('h1', {}, tr(title)), h('p', {}, tr(sub)));
}

function files(n: number): string {
  return n === 1 ? tr('ihFilesOne') : tr('ihFilesMany', { n });
}

function formatSize(bytes: number): string {
  const fr = document.documentElement.lang === 'fr';
  const num = new Intl.NumberFormat(document.documentElement.lang, { maximumFractionDigits: 1, minimumFractionDigits: 1 });
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} ${fr ? 'Ko' : 'KB'}`;
  if (bytes < 1024 ** 3) return `${num.format(bytes / 1024 / 1024)} ${fr ? 'Mo' : 'MB'}`;
  return `${num.format(bytes / 1024 ** 3)} ${fr ? 'Go' : 'GB'}`;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(document.documentElement.lang, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function toast(text: string, bad = false, sticky = false): void {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  if (!sticky) toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3200);
}

function list(query: Partial<ImageQuery>): Promise<ImageListResult> {
  return desk.invoke<ImageListResult>(CH.imagehostList, { ...BASE_QUERY, ...query });
}

async function loadFolders(): Promise<ImageFolder[]> {
  if (folders) return folders;
  const res = await desk.invoke<ImageFoldersResult>(CH.imagehostFolders);
  folders = res.ok ? res.items : [];
  return folders;
}

function linkOf(item: ImageItem): string | null {
  return settings.imagehostLink === 'raw' ? (item.rawUrl ?? item.url) : (item.url ?? item.rawUrl);
}

async function upload(list: File[]): Promise<void> {
  if (!list.length) return;
  if (!hasKey) return toast(tr('errNoKey'), true);
  const picked = list.slice(0, 20);
  toast(picked.length === 1 ? tr('uploadingOne') : tr('uploadingMany', { n: picked.length }), false, true);
  const payload: OutgoingFile[] = await Promise.all(
    picked.map(async (f) => ({ name: f.name, type: f.type, bytes: new Uint8Array(await f.arrayBuffer()) })),
  );
  const results = await desk.invoke<UploadOutcome[]>(CH.imagehostUpload, payload);
  const done = results.filter((r) => r.ok).length;
  const failed = results.find((r): r is Extract<UploadOutcome, { ok: false }> => !r.ok);
  if (failed) toast(`${failed.name} : ${tr(IMAGE_ERRORS[failed.error])}`, true);
  else toast(done === 1 ? tr('uploadDone') : tr('uploadDoneMany', { n: done }));
}

function go(next: Section): void {
  stopRecording();
  closeViewer();
  section = next;
  try {
    sessionStorage.setItem('section', next);
  } catch {
  }
  renderFrame();
  void renderSection();
}

function buildNav(): void {
  for (const [id, label, iconName] of SECTIONS) {
    const item = h('button', { type: 'button', class: 'nav-item', 'data-section': id }, svg(iconName), h('span', {}, tr(label)));
    item.addEventListener('click', () => go(id));
    nav.append(item);
  }
  keyCard.addEventListener('click', () => go('settings'));
  topActions.append(
    button('btn soft', tr('ihNavCapture'), () => desk.send(CH.imagehostCapture, 'area'), 'camera'),
    iconButton('btn soft icon', tr('ihDropTitle'), 'upload', () => fileInput.click()),
    iconButton('btn soft icon', tr('ihNavSettings'), 'gear', () => go('settings')),
  );
  fileInput.addEventListener('change', () => {
    void upload([...(fileInput.files ?? [])]);
    fileInput.value = '';
  });
}

function renderFrame(): void {
  for (const item of nav.querySelectorAll<HTMLButtonElement>('.nav-item')) {
    if (item.dataset.section === section) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
  const label = SECTIONS.find(([id]) => id === section)![1];
  crumbs.replaceChildren(h('li', {}, 'ImageHost'), h('li', {}, svg('chevron'), tr(label)));
  keyCard.dataset.ok = String(hasKey);
  keyCard.replaceChildren(h('small', {}, tr('imagehostKey')), h('strong', {}, tr(hasKey ? 'ihKeyOk' : 'ihKeyMissing')));
  for (const b of topActions.querySelectorAll('button')) b.disabled = !hasKey && b.title !== tr('ihNavSettings');
}

async function renderSection(): Promise<void> {
  const mine = ++renderSeq;
  content.replaceChildren();
  content.scrollTop = 0;
  switch (section) {
    case 'overview':
      return showOverview(mine);
    case 'gallery':
      return showGallery();
    case 'folders':
      return showFolders(mine);
    case 'capture':
      return showCapture();
    case 'settings':
      return showSettings();
  }
}

function noKey(): HTMLElement {
  return h(
    'div',
    { class: 'card empty' },
    h('h2', { class: 'card-title' }, tr('ihNoKeyTitle')),
    h('p', {}, `${tr('ihNoKeyBody')} ${tr('imagehostKeyHint')}`),
    button('btn solid', tr('ihNoKeyBtn'), () => go('settings')),
  );
}

function failure(error: ImageError, retry: () => void): HTMLElement {
  return h('div', { class: 'card empty' }, h('p', {}, tr(IMAGE_ERRORS[error])), button('btn', tr('ihRetry'), retry));
}

function statCard(label: StringKey, iconName: IconName, value: string): HTMLElement {
  return h(
    'div',
    { class: 'card stat' },
    h('div', { class: 'stat-top' }, h('span', {}, tr(label)), svg(iconName)),
    h('div', { class: 'stat-value' }, value),
  );
}

function dropCard(): HTMLElement {
  const zone = h('button', { type: 'button', class: 'drop-zone' }, svg('upload', 22), h('strong', {}, tr('ihPick')));
  zone.disabled = !hasKey;
  zone.addEventListener('click', () => fileInput.click());
  return h('div', { class: 'card pad' }, h('h2', { class: 'card-title' }, tr('ihDropTitle')), h('p', { class: 'card-sub' }, tr('ihDropSub')), zone);
}

async function showOverview(mine: number): Promise<void> {
  content.append(pageHead('ihNavOverview', 'ihOverviewSub'));
  if (!hasKey) return void content.append(noKey());

  const loading = h('p', { class: 'hint' }, tr('ihLoading'));
  content.append(loading);
  if (!stats || Date.now() - stats.at > STATS_TTL) {
    const [all, images, videos, folderList] = await Promise.all([
      list({ limit: 8 }),
      list({ type: 'image', limit: 1 }),
      list({ type: 'video', limit: 1 }),
      loadFolders(),
    ]);
    if (mine !== renderSeq) return;
    if (!all.ok) {
      loading.replaceWith(failure(all.error, () => void renderSection()));
      return;
    }
    stats = {
      files: all.total,
      images: images.ok ? images.total : 0,
      videos: videos.ok ? videos.total : 0,
      folders: folderList.length,
      recent: all.items,
      at: Date.now(),
    };
  }
  if (mine !== renderSeq) return;
  const num = new Intl.NumberFormat(document.documentElement.lang);
  loading.replaceWith(
    h(
      'div',
      { class: 'stats' },
      statCard('ihStatFiles', 'storage', num.format(stats.files)),
      statCard('ihStatImages', 'image', num.format(stats.images)),
      statCard('ihStatVideos', 'play', num.format(stats.videos)),
      statCard('ihStatFolders', 'folder', num.format(stats.folders)),
    ),
  );
  const head = h(
    'div',
    { class: 'section-head' },
    h('div', {}, h('h2', { class: 'card-title' }, tr('ihRecent')), h('p', { class: 'card-sub' }, tr('ihRecentSub'))),
    button('link-btn', tr('ihSeeAll'), () => go('gallery')),
  );
  const grid = h('ul', { class: 'grid' }, ...stats.recent.map(fileCard));
  content.append(head, stats.recent.length ? grid : h('p', { class: 'hint' }, tr('ihEmpty')), h('div', { class: 'section-head' }), dropCard());
}

function fileCard(item: ImageItem, index = 0, list: ImageItem[] = [item]): HTMLLIElement {
  const thumb = h('div', { class: 'thumb', role: 'button', tabindex: '0', 'aria-label': tr('ihViewFile', { name: item.originalName }) });
  thumb.addEventListener('click', () => openViewer(list, index));
  thumb.addEventListener('keydown', (event) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      openViewer(list, index);
    }
  });
  const label = () => thumb.replaceChildren(h('span', { class: 'ext' }, (item.name.split('.').pop() ?? '').toUpperCase()));
  if (item.rawUrl && item.type === 'image') {
    const img = h('img', { alt: '', loading: 'lazy', decoding: 'async', src: item.rawUrl });
    img.addEventListener('error', label);
    thumb.append(img);
  } else if (item.rawUrl && item.type === 'video') {
    const video = h('video', { preload: 'metadata', src: item.rawUrl });
    video.muted = true;
    video.addEventListener('error', label);
    thumb.append(video, h('span', { class: 'play-badge' }, svg('play', 28)));
  } else if (item.type === 'audio') {
    thumb.append(
      h(
        'div',
        { class: 'audio' },
        h('span', { class: 'play-badge' }, svg('play', 26)),
        h('span', { class: 'ext' }, (item.name.split('.').pop() ?? '').toUpperCase()),
      ),
    );
  } else {
    label();
  }
  const link = linkOf(item);
  const open = item.url ?? item.rawUrl;
  const actions = h('div', { class: 'file-actions' });
  actions.addEventListener('click', (event) => event.stopPropagation());
  actions.addEventListener('keydown', (event) => event.stopPropagation());
  if (link) {
    actions.append(
      iconButton('round', tr('ihCopy'), 'link', () => {
        desk.send(CH.imagehostCopy, linkOf(item));
        toast(tr('ihCopied'));
      }),
    );
  }
  if (open) actions.append(iconButton('round', tr('ihOpen'), 'external', () => desk.send(CH.imagehostOpen, open)));
  thumb.append(actions);

  const name = h('p', { class: 'file-name', title: item.originalName }, item.originalName, h('span', {}, ` (${formatSize(item.size)})`));
  const meta = h(
    'div',
    { class: 'file-meta' },
    h('span', {}, formatDate(item.uploadAt)),
    h('span', { class: 'views', title: String(item.views) }, svg('eye', 14), String(item.views)),
  );
  return h('li', { class: 'card file' }, thumb, h('div', { class: 'file-body' }, name, meta));
}

function selectField(cls: string, label: string, options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLElement {
  const select = h('select', { 'aria-label': label });
  for (const [v, text] of options) select.append(new Option(text, v, false, v === value));
  select.addEventListener('change', () => onChange(select.value));
  return h('label', { class: `field ${cls}` }, select, (() => {
    const chev = svg('updown');
    chev.classList.add('chev');
    return chev;
  })());
}

function switchControl(label: string, checked: boolean, onChange: (on: boolean) => void): HTMLButtonElement {
  const sw = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-label': label, 'aria-checked': String(checked) });
  sw.addEventListener('click', () => {
    const next = sw.getAttribute('aria-checked') !== 'true';
    sw.setAttribute('aria-checked', String(next));
    onChange(next);
  });
  return sw;
}

function segmented(label: string, options: Array<[string, string]>, value: string, onPick: (v: string) => void): HTMLElement {
  const seg = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label });
  for (const [v, text] of options) {
    const opt = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value) }, text);
    opt.addEventListener('click', () => {
      for (const o of seg.querySelectorAll('button')) o.setAttribute('aria-checked', String(o === opt));
      onPick(v);
    });
    seg.append(opt);
  }
  return seg;
}

function showGallery(): void {
  content.append(pageHead('ihNavGallery', 'ihGallerySub'));
  if (!hasKey) return void content.append(noKey());
  const q = gallery.query;

  const search = h('input', { type: 'search', placeholder: tr('ihSearch'), 'aria-label': tr('ihSearch') });
  search.value = q.search;
  let timer = 0;
  search.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      gallery.query = { ...gallery.query, search: search.value };
      void loadGallery(true);
    }, 400);
  });
  const sortValue = SORTS.find(([, , s]) => s.sort === q.sort && s.order === q.order)?.[0] ?? 'newest';
  const folderField = selectField('w-folder', tr('ihFolderAll'), [['all', tr('ihFolderAll')], ['none', tr('ihFolderNone')]], q.folderId, (v) => {
    gallery.query = { ...gallery.query, folderId: v };
    void loadGallery(true);
  });
  void loadFolders().then((list) => {
    const select = folderField.querySelector('select')!;
    for (const f of list) select.append(new Option(`${f.name} (${f.fileCount})`, f.id, false, f.id === gallery.query.folderId));
  });

  const toolbar = h(
    'div',
    { class: 'toolbar' },
    h('label', { class: 'field grow with-icon' }, svg('search'), search),
    selectField('w-select', tr('ihSortNewest'), SORTS.map(([v, k]) => [v, tr(k)]), sortValue, (v) => {
      gallery.query = { ...gallery.query, ...SORTS.find(([id]) => id === v)![2] };
      void loadGallery(true);
    }),
    folderField,
    h(
      'div',
      { class: 'switch-field' },
      h('span', {}, tr('ihFavorites')),
      switchControl(tr('ihFavorites'), q.favoriteOnly, (on) => {
        gallery.query = { ...gallery.query, favoriteOnly: on };
        void loadGallery(true);
      }),
    ),
    segmented(tr('ihTypeAll'), [['all', tr('ihTypeAll')], ['image', tr('ihTypeImages')], ['video', tr('ihTypeVideos')]], q.type, (v) => {
      gallery.query = { ...gallery.query, type: v as ImageQuery['type'] };
      void loadGallery(true);
    }),
  );

  const more = button('btn', tr('ihMore'), () => void loadGallery(false));
  content.append(
    toolbar,
    h('div', { id: 'g-state' }),
    h('ul', { class: 'grid', id: 'g-grid' }),
    h('div', { class: 'more', id: 'g-more' }, more),
  );
  void loadGallery(true);
}

async function loadGallery(reset: boolean): Promise<void> {
  const mine = ++gallery.seq;
  gallery.loading = true;
  gallery.error = null;
  if (reset) {
    gallery.items = [];
    gallery.total = 0;
  }
  drawGallery();
  const res = await list({ ...gallery.query, offset: reset ? 0 : gallery.items.length });
  if (mine !== gallery.seq) return;
  gallery.loading = false;
  if (res.ok) {
    gallery.items = reset ? res.items : [...gallery.items, ...res.items];
    gallery.total = res.total;
  } else {
    gallery.error = res.error;
  }
  drawGallery();
}

function drawGallery(): void {
  const grid = document.getElementById('g-grid');
  const state = document.getElementById('g-state');
  const more = document.getElementById('g-more');
  if (!grid || !state || !more) return;
  grid.replaceChildren(...gallery.items.map(fileCard));
  more.hidden = gallery.loading || !!gallery.error || gallery.items.length >= gallery.total;
  state.replaceChildren();
  if (gallery.error) state.append(failure(gallery.error, () => void loadGallery(true)));
  else if (gallery.loading && !gallery.items.length) state.append(h('p', { class: 'hint' }, tr('ihLoading')));
  else if (!gallery.loading && !gallery.items.length) {
    const q = gallery.query;
    const filtered = q.search || q.folderId !== 'all' || q.type !== 'all' || q.favoriteOnly;
    state.append(h('div', { class: 'card empty' }, h('p', {}, tr(filtered ? 'ihNoResult' : 'ihEmpty'))));
  }
}

async function showFolders(mine: number): Promise<void> {
  content.append(pageHead('ihNavFolders', 'ihFoldersSub'));
  if (!hasKey) return void content.append(noKey());
  const loading = h('p', { class: 'hint' }, tr('ihLoading'));
  content.append(loading);
  const list = await loadFolders();
  if (mine !== renderSeq) return;
  if (!list.length) {
    loading.replaceWith(h('div', { class: 'card empty' }, h('p', {}, tr('ihFoldersEmpty'))));
    return;
  }
  const grid = h('ul', { class: 'grid' });
  for (const f of list) {
    const mosaic = f.previews.length
      ? h('div', { class: 'mosaic', 'data-count': String(f.previews.length) }, ...f.previews.map((src) => h('img', { alt: '', loading: 'lazy', src })))
      : h('div', { class: 'mosaic empty' }, svg('folder', 28));
    const card = h(
      'button',
      { type: 'button', class: 'card folder' },
      mosaic,
      h(
        'div',
        { class: 'file-body' },
        h('p', { class: 'file-name' }, f.name),
        h('div', { class: 'file-meta' }, h('span', {}, files(f.fileCount)), h('span', {}, formatSize(f.totalBytes))),
      ),
    );
    card.addEventListener('click', () => {
      gallery.query = { ...BASE_QUERY, folderId: f.id };
      go('gallery');
    });
    grid.append(h('li', {}, card));
  }
  loading.replaceWith(grid);
}

function keys(...names: string[]): HTMLElement {
  const row = h('div', { class: 'keys' });
  names.forEach((k, i) => {
    if (i) row.append('+');
    row.append(h('kbd', {}, k));
  });
  return row;
}

function captureTile(title: StringKey, sub: StringKey, iconName: IconName, shortcut: ShortcutKey, action: StringKey, kind: string): HTMLElement {
  const b = button('btn soft', tr(action), () => desk.send(CH.imagehostCapture, kind), iconName);
  b.disabled = !hasKey;
  return h(
    'div',
    { class: 'card tile' },
    h('div', { class: 'tile-top' }, h('h2', { class: 'card-title' }, tr(title)), svg(iconName)),
    h('p', { class: 'card-sub' }, tr(sub)),
    keys(...shortcutLabels(settings[shortcut], lang())),
    b,
  );
}

function showCapture(): void {
  content.append(pageHead('ihNavCapture', 'ihCaptureSub'));
  if (!hasKey) content.append(noKey(), h('div', { class: 'section-head' }));
  content.append(
    h(
      'div',
      { class: 'tiles' },
      captureTile('ihCaptureArea', 'ihCaptureAreaSub', 'camera', 'shortcutArea', 'ihCaptureAreaBtn', 'area'),
      captureTile('ihCaptureScreen', 'ihCaptureScreenSub', 'screen', 'shortcutScreen', 'ihCaptureScreenBtn', 'screen'),
      captureTile('ihClipboard', 'ihClipboardSub', 'clipboard', 'shortcutClipboard', 'ihClipboardBtn', 'clipboard'),
    ),
    h('div', { class: 'section-head' }),
    dropCard(),
  );
}

function setSetting(patch: SettingsPatch): void {
  settings = { ...settings, ...patch };
  desk.send(CH.settingsSet, patch);
}

function textBlock(label: StringKey, hint?: StringKey): HTMLElement {
  return h('div', {}, h('div', { class: 'label' }, tr(label)), hint ? h('p', { class: 'hint' }, tr(hint)) : null);
}

function showSettings(): void {
  content.append(pageHead('ihNavSettings', 'ihSettingsSub'));

  const input = h('input', {
    type: 'password',
    autocomplete: 'off',
    spellcheck: 'false',
    placeholder: tr('imagehostKeyPlaceholder'),
    'aria-label': tr('imagehostKey'),
  });
  const save = h('button', { type: 'submit', class: 'btn solid' }, tr('imagehostKeySave'));
  const form = h('form', { class: 'key-form' }, h('label', { class: 'field' }, input), save);
  const status = h('p', { class: 'status', role: 'status' }, tr(hasKey ? 'imagehostKeySaved' : 'imagehostKeyNone'));
  const remove = button('btn danger', tr('imagehostKeyRemove'), async () => {
    const res = await desk.invoke<KeyResult | null>(CH.imagehostKey, null);
    if (res) keyChanged(res.hasKey);
    status.textContent = tr('imagehostKeyNone');
    remove.hidden = true;
  });
  remove.hidden = !hasKey;
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!value) return;
    save.disabled = true;
    status.classList.remove('bad');
    status.textContent = tr('imagehostKeyChecking');
    const res = await desk.invoke<KeyResult | null>(CH.imagehostKey, value);
    save.disabled = false;
    if (!res) return;
    keyChanged(res.hasKey);
    remove.hidden = !res.hasKey;
    if (res.error) {
      status.textContent = tr(IMAGE_ERRORS[res.error]);
      status.classList.add('bad');
      return;
    }
    input.value = '';
    status.textContent = tr('imagehostKeySaved');
  });

  queueMicrotask(renderShortcuts);
  content.append(
    h(
      'div',
      { class: 'settings' },
      h(
        'section',
        { class: 'card pad' },
        h('h2', { class: 'card-title' }, tr('imagehostKey')),
        h('p', { class: 'card-sub' }, tr('imagehostKeyHint')),
        form,
        h('div', { class: 'row' }, status, remove),
      ),
      h(
        'section',
        { class: 'card pad' },
        h('h2', { class: 'card-title' }, tr('ihAfterUpload')),
        h(
          'div',
          { class: 'seg-row spaced' },
          textBlock('imagehostLink'),
          segmented(tr('imagehostLink'), [['page', tr('linkPage')], ['raw', tr('linkRaw')]], settings.imagehostLink, (v) =>
            setSetting({ imagehostLink: v === 'raw' ? 'raw' : 'page' }),
          ),
        ),
        h(
          'div',
          { class: 'row' },
          textBlock('imagehostSaveLocal', 'imagehostSaveLocalHint'),
          switchControl(tr('imagehostSaveLocal'), settings.imagehostSaveLocal, (on) => setSetting({ imagehostSaveLocal: on })),
        ),
      ),
      h(
        'section',
        { class: 'card pad' },
        h('h2', { class: 'card-title' }, tr('ihShortcuts')),
        h(
          'div',
          { class: 'row spaced' },
          textBlock('imagehostShortcuts', 'imagehostShortcutsHint'),
          switchControl(tr('imagehostShortcuts'), settings.imagehostShortcuts, (on) => {
            setSetting({ imagehostShortcuts: on });
            renderShortcuts();
          }),
        ),
        h('div', { class: 'sc-rows', id: 'sc-rows' }),
        h('p', { class: 'hint spaced' }, tr('ihShortcutTabHint')),
      ),
    ),
  );
}

function lang(): string {
  return document.documentElement.lang;
}

function renderShortcuts(): void {
  const box = document.getElementById('sc-rows');
  if (!box) return;
  box.replaceChildren(...SHORTCUT_ROWS.map(([key, label]) => shortcutRow(key, label)));
}

function shortcutRow(key: ShortcutKey, label: StringKey): HTMLElement {
  const acc = settings[key];
  const live = recording === key;
  const taken = settings.imagehostShortcuts && !live && shortcutStatus?.[key] === false;
  let note: { text: string; bad: boolean } | null = null;
  if (shortcutNote?.key === key) note = shortcutNote;
  else if (live) note = { text: tr('ihShortcutRecording'), bad: false };
  else if (taken) note = { text: tr('ihShortcutTaken'), bad: true };

  const combo = live ? h('span', { class: 'rec' }, tr('ihShortcutPress')) : keys(...shortcutLabels(acc, lang()));
  const actions = h('div', { class: 'sc-actions' });
  if (acc !== DEFAULT_SHORTCUTS[key] && !live) {
    actions.append(
      button('link-btn', tr('ihShortcutDefault'), () => {
        shortcutNote = null;
        setSetting({ [key]: DEFAULT_SHORTCUTS[key] } as SettingsPatch);
        renderShortcuts();
      }),
    );
  }
  actions.append(
    live
      ? button('btn', tr('ihViewerClose'), () => stopRecording())
      : button('btn soft', tr('ihShortcutChange'), () => startRecording(key)),
  );
  return h(
    'div',
    { class: `sc-row${live ? ' live' : ''}` },
    h('div', { class: 'sc-text' }, h('div', { class: 'label' }, tr(label)), note ? h('p', { class: `hint${note.bad ? ' bad' : ''}` }, note.text) : null),
    combo,
    actions,
  );
}

function startRecording(key: ShortcutKey): void {
  stopRecording();
  recording = key;
  shortcutNote = null;
  desk.send(CH.shortcutPause, true);
  window.addEventListener('keydown', onRecordKey, true);
  window.addEventListener('keyup', onRecordKeyUp, true);
  window.addEventListener('blur', stopRecording);
  renderShortcuts();
}

function stopRecording(): void {
  if (!recording) return;
  recording = null;
  window.removeEventListener('keydown', onRecordKey, true);
  window.removeEventListener('keyup', onRecordKeyUp, true);
  window.removeEventListener('blur', stopRecording);
  desk.send(CH.shortcutPause, false);
  renderShortcuts();
}

function onRecordKey(event: KeyboardEvent): void {
  event.preventDefault();
  event.stopPropagation();
  if (event.key === 'Escape' && !event.ctrlKey && !event.altKey && !event.shiftKey && !event.metaKey) return stopRecording();
  if (event.code !== 'PrintScreen') tryShortcut(shortcutFromEvent(event));
}

function onRecordKeyUp(event: KeyboardEvent): void {
  if (event.code !== 'PrintScreen') return;
  event.preventDefault();
  tryShortcut(shortcutFromEvent(event));
}

function tryShortcut(acc: string | null): void {
  const key = recording;
  if (!key || !acc) return;
  if (!isValidShortcut(acc)) {
    shortcutNote = { key, text: tr('ihShortcutInvalid'), bad: true };
    return renderShortcuts();
  }
  if (SHORTCUT_KEYS.some((other) => other !== key && settings[other] === acc)) {
    shortcutNote = { key, text: tr('ihShortcutDuplicate'), bad: true };
    return renderShortcuts();
  }
  shortcutNote = null;
  setSetting({ [key]: acc } as SettingsPatch);
  stopRecording();
}

function openViewer(list: ImageItem[], index: number): void {
  if (!list[index]) return;
  closeViewer();
  const el = h('div', { class: 'viewer', role: 'dialog', 'aria-modal': 'true' });
  el.addEventListener('click', (event) => {
    if (event.target === el || (event.target as HTMLElement).classList.contains('viewer-stage')) closeViewer();
  });
  viewer = { list, index, el, back: document.activeElement as HTMLElement | null };
  document.body.append(el);
  drawViewer();
}

function closeViewer(): void {
  if (!viewer) return;
  const back = viewer.back;
  viewer.el.remove();
  viewer = null;
  back?.focus();
}

function moveViewer(step: number): void {
  if (!viewer) return;
  const next = viewer.index + step;
  if (next < 0 || next >= viewer.list.length) return;
  viewer.index = next;
  drawViewer();
}

function drawViewer(): void {
  if (!viewer) return;
  const { list, index, el } = viewer;
  const item = list[index];
  el.setAttribute('aria-label', item.originalName);

  let media: HTMLElement;
  if (item.rawUrl && item.type === 'image') {
    media = h('img', { class: 'viewer-media', src: item.rawUrl, alt: item.originalName });
  } else if (item.rawUrl && item.type === 'video') {
    media = h('video', { class: 'viewer-media', src: item.rawUrl, controls: '', autoplay: '', playsinline: '' });
  } else if (item.rawUrl && item.type === 'audio') {
    media = h('div', { class: 'viewer-audio' }, h('span', { class: 'play-badge' }, svg('play', 28)), h('audio', { src: item.rawUrl, controls: '', autoplay: '' }));
  } else {
    media = h('div', { class: 'viewer-audio' }, h('span', { class: 'ext' }, (item.name.split('.').pop() ?? '').toUpperCase()));
  }

  const views = item.views === 1 ? tr('ihViewsOne') : tr('ihViews', { n: item.views });
  const meta = [formatSize(item.size), formatDate(item.uploadAt), views, item.folder?.name].filter(Boolean).join(', ');
  const link = linkOf(item);
  const open = item.url ?? item.rawUrl;
  const close = iconButton('btn icon', tr('ihViewerClose'), 'close', closeViewer);
  const head = h(
    'div',
    { class: 'viewer-head' },
    h('div', { class: 'viewer-title' }, h('p', { class: 'file-name' }, item.originalName), h('p', { class: 'hint' }, meta)),
    h(
      'div',
      { class: 'viewer-actions' },
      link
        ? button('btn soft', tr('ihCopy'), () => {
            desk.send(CH.imagehostCopy, link);
            toast(tr('ihCopied'));
          }, 'link')
        : null,
      open ? iconButton('btn soft icon', tr('ihOpen'), 'external', () => desk.send(CH.imagehostOpen, open)) : null,
      close,
    ),
  );
  const prev = iconButton('round big', tr('ihViewerPrev'), 'back', () => moveViewer(-1), 20);
  const next = iconButton('round big', tr('ihViewerNext'), 'chevron', () => moveViewer(1), 20);
  prev.disabled = index === 0;
  next.disabled = index === list.length - 1;
  el.replaceChildren(head, h('div', { class: 'viewer-stage' }, prev, media, next));
  close.focus();
}

function keyChanged(next: boolean): void {
  if (next !== hasKey) {
    stats = null;
    folders = null;
  }
  hasKey = next;
  renderFrame();
}

function wireDrop(): void {
  let depth = 0;
  const hasFiles = (event: DragEvent) => !!event.dataTransfer?.types.includes('Files');
  window.addEventListener('dragenter', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    depth++;
    byId('veil-text').textContent = hasKey ? tr('ihDropOverlay') : tr('errNoKey');
    veil.hidden = false;
  });
  window.addEventListener('dragover', (event) => {
    if (!hasFiles(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = hasKey ? 'copy' : 'none';
  });
  window.addEventListener('dragleave', () => {
    depth = Math.max(0, depth - 1);
    if (!depth) veil.hidden = true;
  });
  window.addEventListener('drop', (event) => {
    event.preventDefault();
    depth = 0;
    veil.hidden = true;
    void upload([...(event.dataTransfer?.files ?? [])]);
  });
}

async function main(): Promise<void> {
  const init = await desk.invoke<UiInit>(CH.init);
  setLocale(init.locale);
  settings = init.settings;
  hasKey = !!init.hasKey;
  shortcutStatus = init.shortcuts ?? null;
  try {
    const saved = sessionStorage.getItem('section') as Section | null;
    if (saved && SECTIONS.some(([id]) => id === saved)) section = saved;
  } catch {
  }
  buildNav();
  wireDrop();
  renderFrame();
  void renderSection();

  desk.on<Settings>(CH.settingsChanged, (next) => {
    settings = next;
  });
  desk.on<ShortcutStatus>(CH.shortcutStatus, (next) => {
    shortcutStatus = next;
    renderShortcuts();
  });
  window.addEventListener('keydown', (event) => {
    if (!viewer || recording) return;
    if (event.key === 'Escape') closeViewer();
    else if (event.key === 'ArrowLeft') moveViewer(-1);
    else if (event.key === 'ArrowRight') moveViewer(1);
  });
  desk.on(CH.imagehostUploaded, () => {
    stats = null;
    folders = null;
    if (section === 'overview' || section === 'folders') void renderSection();
    if (section === 'gallery') void loadGallery(true);
  });
}

void main();
