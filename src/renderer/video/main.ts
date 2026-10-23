import { CH } from '../../shared/channels';
import { IMAGE_ERRORS, type StringKey } from '../../shared/i18n';
import type {
  AnimProp,
  Clip,
  EffectStyle,
  ImageItem,
  ImageListResult,
  MediaItem,
  Project,
  ProjectSummary,
  RecordingSummary,
  SessionMedia,
  ShapeStyle,
  TextStyle,
  Track,
  TransitionKind,
  UploadOutcome,
  VideoInit,
  VideoOutputAction,
  ZoomSegment,
} from '../../shared/types';
import { applyFont, desk, LOGOS, setLocale, tr } from '../common';
import { icon } from '../hicons';
import { exportGif, exportProject } from './export';
import { Player } from './player';
import {
  autoZooms,
  clipEnd,
  clipLength,
  duration,
  even,
  History,
  keyframeAt,
  mediaOf,
  MIN_CLIP,
  newClip,
  newEffectClip,
  newProject,
  newShapeClip,
  newTextClip,
  newTrack,
  probe,
  projectFromRecording,
  sample,
  setValue,
  toggleKeyframe,
  trackEnd,
  trackFor,
  typeOf,
  uid,
} from './project';
import { setTextFamily } from './render';
import { makeSound, SOUNDS, wav } from './sounds';
import { timecode, Timeline } from './timeline';

let project: Project = newProject('');
let selectedId: string | null = null;
let hasKey = false;
let autoZoom = false;
const history = new History();
let saveTimer = 0;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('canvas');
const bin = $('bin');
const inspector = $('inspector');
const home = $('home');
const modal = $('modal');
const toastEl = $('toast');
let toastTimer = 0;

const stroke = (body: string, size = 16) =>
  `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const fillIcon = (body: string, size = 16) => `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg>`;
const I = {
  undo: stroke('<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>'),
  redo: stroke('<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>'),
  home: stroke('<path d="M4 11 12 4l8 7v9H4z"/><path d="M10 20v-6h4v6"/>'),
  play: fillIcon('<path fill="currentColor" d="M8 5v14l11-7z"/>', 18),
  pause: fillIcon('<path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>', 18),
  prev: fillIcon('<path fill="currentColor" d="M6 5h2v14H6zM19 5v14L9 12z"/>'),
  next: fillIcon('<path fill="currentColor" d="M16 5h2v14h-2zM5 5v14l10-7z"/>'),
  split: stroke('<path d="M12 3v18M7 7l-3 5 3 5M17 7l3 5-3 5"/>'),
  trash: stroke('<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/>'),
  plus: stroke('<path d="M12 5v14M5 12h14"/>'),
  minus: stroke('<path d="M5 12h14"/>'),
  fit: stroke('<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>'),
  film: stroke('<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>'),
  music: stroke('<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>'),
  rec: fillIcon('<circle cx="12" cy="12" r="6" fill="currentColor"/>'),
  save: stroke('<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>'),
  folder: icon('folder', 16),
  upload: icon('upload', 16),
  copy: icon('copy', 16),
  image: icon('image', 16),
};

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, ...kids: Array<Node | string | null>): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  for (const kid of kids) if (kid !== null) el.append(kid);
  return el;
}

function btn(cls: string, label: string, svg: string | null, onClick: () => void, title = label): HTMLButtonElement {
  const b = h('button', { type: 'button', class: cls, title });
  if (svg) b.innerHTML = svg;
  if (cls.includes('icon')) b.setAttribute('aria-label', label);
  else b.append(label);
  b.addEventListener('click', onClick);
  return b;
}

function toast(text: string, bad = false): void {
  toastEl.textContent = text;
  toastEl.classList.toggle('bad', bad);
  toastEl.hidden = false;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toastEl.hidden = true), 3600);
}

function call<T>(op: string, data: Record<string, unknown> = {}): Promise<T> {
  return desk.invoke<T>(CH.videoCall, { op, ...data });
}

function seconds(t: number): string {
  return `${t.toFixed(t < 10 ? 2 : 1)} s`;
}

const clock = h('span', { class: 'vd-clock' }, '0:00.0 / 0:00.0');
let playBtn: HTMLButtonElement;

const player = new Player(
  canvas,
  (t) => {
    clock.textContent = `${timecode(t, true)} / ${timecode(duration(project), true)}`;
    timeline.setTime(t);
    if (!player.playing && Math.abs(t - inspectorTime) > 1e-4 && selectedId) requestAnimationFrame(() => renderInspector());
  },
  (playing) => {
    playBtn.innerHTML = playing ? I.pause : I.play;
    playBtn.title = tr(playing ? 'vdPause' : 'vdPlay');
  },
);

const timeline = new Timeline($('timeline'), {
  project: () => project,
  selected: () => selectedId,
  select: (id) => {
    selectedId = id;
    renderInspector();
    for (const el of document.querySelectorAll<HTMLElement>('.clip')) el.classList.toggle('selected', el.dataset.clip === id);
  },
  time: () => player.time,
  seek: (t) => player.seek(t),
  changed: (commitIt) => (commitIt ? commit() : player.setProject(project)),
  dropMedia: (id, track, t) => {
    const media = project.media.find((m) => m.id === id);
    if (media) addClip(media, track, t);
  },
  label: (kind, n) => `${kind === 'video' ? 'V' : 'A'}${n}`,
  clipLabel: (clip) => clipLabel(clip),
  get muteLabel() {
    return tr('vdMute');
  },
});

function commit(): void {
  project.updated = new Date().toISOString();
  history.push(project);
  scheduleSave();
  renderAll();
}

function scheduleSave(): void {
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void call('saveProject', { project }), 700);
}

function renderAll(): void {
  player.setProject(project);
  timeline.render();
  renderBin();
  renderInspector();
  updateHistoryButtons();
  titleInput.value = project.name;
  document.title = `${project.name} | haunt+`;
}

function openProject(p: Project): void {
  player.pause();
  project = p;
  selectedId = null;
  history.reset(p);
  home.hidden = true;
  document.body.classList.remove('at-home');
  player.seek(0);
  timeline.fit();
  renderAll();
}

function selectedClip(): { clip: Clip; track: Track } | null {
  for (const track of project.tracks) {
    const clip = track.clips.find((c) => c.id === selectedId);
    if (clip) return { clip, track };
  }
  return null;
}

function addClip(media: MediaItem, track: Track | null, at?: number): void {
  const kind: Track['kind'] = media.kind === 'audio' ? 'audio' : 'video';
  const target = track && track.kind === kind ? track : trackFor(project, kind);
  const clip = newClip(media, 0);
  let start = at ?? trackEnd(target);
  for (const c of [...target.clips].sort((a, b) => a.start - b.start)) {
    if (start < clipEnd(c) && start + clipLength(clip) > c.start) start = clipEnd(c);
  }
  clip.start = Math.max(0, start);
  target.clips.push(clip);
  selectedId = clip.id;
  commit();
}

function addMediaOnly(files: Array<{ path: string; url: string; name: string }>): Promise<MediaItem[]> {
  return addMedia(files, {}, false);
}

async function addMedia(files: Array<{ path: string; url: string; name: string }>, extra: Partial<MediaItem> = {}, place = true): Promise<MediaItem[]> {
  const added: MediaItem[] = [];
  for (const f of files) {
    try {
      const m = await probe(f, extra);
      project.media.push(m);
      added.push(m);
    } catch {
      toast(tr('vdCannotRead', { name: f.name }), true);
    }
  }
  const empty = project.tracks.every((t) => !t.clips.length);
  if (place && empty && added[0]) {
    const visual = added.find((m) => m.kind !== 'audio');
    if (visual) {
      project.width = even(visual.width);
      project.height = even(visual.height);
    }
    for (const m of added) addClip(m, null);
    return added;
  }
  commit();
  return added;
}

function split(): void {
  const t = player.time;
  const sel = selectedClip();
  const targets: Array<{ clip: Clip; track: Track }> = [];
  if (sel && t > sel.clip.start && t < clipEnd(sel.clip)) targets.push(sel);
  else
    for (const track of project.tracks)
      for (const clip of track.clips) if (t > clip.start + MIN_CLIP && t < clipEnd(clip) - MIN_CLIP) targets.push({ clip, track });
  if (!targets.length) return;
  for (const { clip, track } of targets) {
    const cut = clip.in + (t - clip.start) * clip.speed;
    const right: Clip = { ...clip, id: uid('c'), start: t, in: cut };
    clip.out = cut;
    track.clips.push(right);
  }
  commit();
}

function removeSelected(ripple: boolean): void {
  const sel = selectedClip();
  if (!sel) return;
  const { clip, track } = sel;
  track.clips = track.clips.filter((c) => c !== clip);
  if (ripple) {
    const len = clipLength(clip);
    for (const c of track.clips) if (c.start >= clipEnd(clip) - 1e-6) c.start -= len;
  }
  selectedId = null;
  commit();
}

const titleInput = h('input', { class: 'vd-title', type: 'text', spellcheck: 'false', maxlength: '80' });
let undoBtn: HTMLButtonElement;
let redoBtn: HTMLButtonElement;
let exportBtn: HTMLButtonElement;

function updateHistoryButtons(): void {
  undoBtn.disabled = !history.canUndo;
  redoBtn.disabled = !history.canRedo;
  exportBtn.disabled = duration(project) <= 0;
}

function undo(): void {
  const p = history.undo();
  if (p) restore(p);
}

function redo(): void {
  const p = history.redo();
  if (p) restore(p);
}

function restore(p: Project): void {
  project = p;
  if (!selectedClip()) selectedId = null;
  scheduleSave();
  renderAll();
}

function buildTop(): void {
  const top = $('top');
  undoBtn = btn('btn icon', tr('annUndo'), I.undo, undo, `${tr('annUndo')} (Ctrl+Z)`);
  redoBtn = btn('btn icon', tr('annRedo'), I.redo, redo, `${tr('annRedo')} (Ctrl+Y)`);
  exportBtn = btn('btn solid', tr('vdExport'), I.upload, openExport, `${tr('vdExport')} (Ctrl+E)`);
  titleInput.addEventListener('change', () => {
    project.name = titleInput.value.trim() || project.name;
    commit();
  });
  titleInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') titleInput.blur();
    e.stopPropagation();
  });
  top.append(
    h('div', { class: 'ed-title' }, h('img', { src: LOGOS.images, alt: '' }), tr('vdTitle')),
    btn('btn icon', tr('vdHome'), I.home, () => void showHome()),
    titleInput,
    h('span', { class: 'sep' }),
    undoBtn,
    redoBtn,
    h('span', { class: 'spacer' }),
    exportBtn,
  );
}

function renderBin(): void {
  bin.replaceChildren(
    h('p', { class: 'vd-section-title' }, tr('vdMedia')),
    h(
      'div',
      { class: 'vd-bin-actions' },
      btn('btn', tr('vdImportPc'), I.folder, () => void importFiles()),
      btn('btn', tr('vdImportGallery'), I.image, () => void openGallery()),
      btn('btn', tr('vdImportRecording'), I.rec, () => void openRecordings()),
      btn('btn', tr('vdSounds'), I.music, () => void openSounds()),
    ),
  );
  if (!project.media.length) {
    bin.append(h('p', { class: 'vd-empty-bin' }, tr('vdBinEmpty')));
    return;
  }
  const list = h('ul', { class: 'vd-media' });
  for (const m of project.media) {
    const thumb = h('div', { class: 'vd-thumb' });
    if (m.kind === 'image') thumb.append(h('img', { src: m.url, alt: '' }));
    else if (m.kind === 'video') {
      const v = h('video', { src: `${m.url}#t=0.5`, preload: 'metadata', muted: '' });
      v.muted = true;
      thumb.append(v);
    } else thumb.innerHTML = I.music;
    const meta = m.kind === 'image' ? `${m.width} × ${m.height}` : timecode(m.duration, true);
    const item = h(
      'li',
      { class: 'vd-item', draggable: 'true', title: tr('vdAddHint') },
      thumb,
      h('div', {}, h('div', { class: 'vd-item-name' }, m.name), h('div', { class: 'vd-item-meta' }, meta)),
    );
    item.addEventListener('dragstart', (e) => e.dataTransfer?.setData('text/x-media', m.id));
    item.addEventListener('dblclick', () => addClip(m, null, player.time));
    list.append(item);
  }
  bin.append(list);
}

async function importFiles(): Promise<void> {
  const files = await call<Array<{ path: string; url: string; name: string }>>('importFiles');
  if (files.length) await addMedia(files);
}

async function openGallery(): Promise<void> {
  const grid = h('div', { class: 'vd-gallery' }, h('p', { class: 'vd-note' }, tr('vdLoading')));
  dialog(tr('vdImportGallery'), [grid], [btn('btn', tr('capCancel'), null, closeDialog)], true);
  const res = await call<ImageListResult | null>('galleryList', { query: { type: 'all', limit: 60, offset: 0 } });
  grid.replaceChildren();
  if (!res || !res.ok) {
    grid.append(h('p', { class: 'vd-note' }, res && !res.ok ? tr(IMAGE_ERRORS[res.error]) : tr('annNoKey')));
    return;
  }
  const usable = res.items.filter((i: ImageItem) => i.rawUrl && (i.type === 'image' || i.type === 'video' || i.type === 'audio'));
  if (!usable.length) grid.append(h('p', { class: 'vd-note' }, tr('ihEmpty')));
  for (const item of usable) {
    const preview =
      item.type === 'image'
        ? h('img', { src: item.rawUrl!, alt: '', loading: 'lazy' })
        : item.type === 'video'
          ? h('video', { src: `${item.rawUrl}#t=0.5`, preload: 'metadata', muted: '' })
          : h('div', { class: 'vd-thumb' });
    const b = h('button', { type: 'button' }, preview, h('span', {}, item.originalName));
    b.addEventListener('click', async () => {
      b.disabled = true;
      toast(tr('vdDownloading'));
      const file = await call<{ path: string; url: string; name: string } | null>('galleryImport', { url: item.rawUrl, name: item.originalName });
      closeDialog();
      if (file) await addMedia([file]);
      else toast(tr('vdCannotRead', { name: item.originalName }), true);
    });
    grid.append(b);
  }
}

async function openRecordings(): Promise<void> {
  const list = h('ul', { class: 'vd-list' });
  dialog(tr('vdImportRecording'), [list], [btn('btn', tr('capCancel'), null, closeDialog)]);
  const recs = await call<RecordingSummary[]>('recordings');
  if (!recs.length) list.append(h('li', {}, h('p', { class: 'vd-note' }, tr('vdNoRecordings'))));
  for (const r of recs) {
    const b = h('button', { type: 'button' }, h('span', {}, formatDate(r.created)), h('span', {}, timecode(r.duration)));
    b.addEventListener('click', async () => {
      closeDialog();
      const rec = await call<SessionMedia | null>('openRecording', { dir: r.dir });
      if (!rec) return;
      const files = (['screen', 'webcam', 'mic'] as const).flatMap((k) => (rec.files[k] ? [{ ...rec.files[k]!, name: tr(`vdTrack_${k}` as StringKey) }] : []));
      for (const f of files) {
        await addMedia([f], { session: rec.dir, crop: f.path === rec.files.screen?.path ? rec.session.area : null });
      }
    });
    list.append(h('li', {}, b));
  }
}

const openSections = new Set<string>(['vdTransform', 'vdText', 'vdShape', 'vdEffect', 'vdSound']);
let inspectorTime = -1;

function field(label: StringKey, control: HTMLElement, value?: string): HTMLElement {
  return h('label', { class: 'prop' }, h('div', { class: 'prop-label' }, h('span', {}, tr(label)), value !== undefined ? h('span', {}, value) : null), control);
}

function range(min: number, max: number, step: number, value: number, onInput: (v: number, done: boolean) => void, show: (v: number) => string): [HTMLElement, HTMLInputElement] {
  const out = h('span', {}, show(value));
  const input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(value) });
  input.addEventListener('input', () => {
    out.textContent = show(Number(input.value));
    onInput(Number(input.value), false);
  });
  input.addEventListener('change', () => onInput(Number(input.value), true));
  return [out, input];
}

function slider(label: StringKey, min: number, max: number, step: number, value: number, apply: (v: number) => void, show: (v: number) => string): HTMLElement {
  const [out, input] = range(min, max, step, value, (v, done) => {
    apply(v);
    if (done) commit();
    else player.setProject(project);
  }, show);
  return h('div', { class: 'prop' }, h('div', { class: 'prop-label' }, h('span', {}, tr(label)), out), input);
}

function segmented(label: StringKey, options: Array<[string, string]>, value: string, pick: (v: string) => void): HTMLElement {
  const seg = h('div', { class: 'seg', role: 'radiogroup' });
  for (const [v, text] of options) {
    const b = h('button', { type: 'button', role: 'radio', 'aria-checked': String(v === value) }, text);
    b.addEventListener('click', () => {
      pick(v);
      commit();
    });
    seg.append(b);
  }
  return h('div', { class: 'prop' }, h('div', { class: 'prop-label' }, h('span', {}, tr(label))), seg);
}

function toggle(label: StringKey, on: boolean, set: (on: boolean) => void): HTMLElement {
  const sw = h('button', { type: 'button', role: 'switch', class: 'switch', 'aria-label': tr(label), 'aria-checked': String(on) });
  sw.addEventListener('click', () => {
    set(sw.getAttribute('aria-checked') !== 'true');
    commit();
  });
  return h('div', { class: 'prop-row' }, h('span', {}, tr(label)), sw);
}

function colorField(label: StringKey, value: string, set: (v: string) => void): HTMLElement {
  const input = h('input', { type: 'color', value });
  input.addEventListener('input', () => {
    set(input.value);
    player.setProject(project);
  });
  input.addEventListener('change', () => {
    set(input.value);
    commit();
  });
  return field(label, input);
}

function section(key: StringKey, ...kids: Array<HTMLElement | null>): HTMLElement {
  const d = h('details', openSections.has(key) ? { open: '' } : {}, h('summary', {}, tr(key)), ...kids);
  d.addEventListener('toggle', () => (d.open ? openSections.add(key) : openSections.delete(key)));
  return d;
}

const pct = (v: number) => `${Math.round(v * 100)} %`;

function tRelOf(clip: Clip): number {
  return Math.max(0, Math.min(clipLength(clip), player.time - clip.start));
}

function keyButton(clip: Clip, prop: AnimProp): HTMLButtonElement {
  const t = tRelOf(clip);
  const b = h('button', {
    type: 'button',
    class: `key${clip.keyframes?.[prop]?.length ? ' animated' : ''}`,
    title: tr('vdKeyframe'),
    'aria-label': tr('vdKeyframe'),
    'aria-pressed': String(!!keyframeAt(clip, prop, t)),
  });
  b.innerHTML = fillIcon('<path fill="currentColor" d="M12 3 21 12 12 21 3 12z"/>', 12);
  b.addEventListener('click', (e) => {
    e.preventDefault();
    toggleKeyframe(clip, prop, t);
    commit();
  });
  return b;
}

function animSlider(clip: Clip, prop: AnimProp, label: StringKey, min: number, max: number, step: number, show: (v: number) => string): HTMLElement {
  const [out, input] = range(min, max, step, sample(clip, prop, tRelOf(clip)), (v, done) => {
    setValue(clip, prop, v, tRelOf(clip));
    if (done) commit();
    else player.setProject(project);
  }, show);
  return h('div', { class: 'prop' }, h('div', { class: 'prop-label' }, h('span', {}, tr(label)), h('span', {}, out, keyButton(clip, prop))), input);
}

function boxSliders(clip: Clip): HTMLElement[] {
  return [
    slider('vdBoxW', 0.02, 1, 0.005, clip.w ?? 0.3, (v) => (clip.w = v), pct),
    slider('vdBoxH', 0.02, 1, 0.005, clip.h ?? 0.15, (v) => (clip.h = v), pct),
  ];
}

function transformSection(clip: Clip, extra: HTMLElement[] = []): HTMLElement {
  return section(
    'vdTransform',
    ...extra,
    animSlider(clip, 'x', 'vdPosX', -1, 1, 0.005, pct),
    animSlider(clip, 'y', 'vdPosY', -1, 1, 0.005, pct),
    animSlider(clip, 'scale', 'vdScale', 0.05, 4, 0.01, pct),
    animSlider(clip, 'rotation', 'vdRotation', -180, 180, 1, (v) => `${Math.round(v)}°`),
    animSlider(clip, 'opacity', 'vdOpacity', 0, 1, 0.01, pct),
    btn('btn', tr('vdResetFrame'), null, () => {
      Object.assign(clip, { x: 0, y: 0, scale: 1, opacity: 1, rotation: 0 });
      if (clip.keyframes) for (const p of ['x', 'y', 'scale', 'rotation', 'opacity'] as const) delete clip.keyframes[p];
      commit();
    }),
    h('p', { class: 'hint' }, tr('vdKeyHint')),
  );
}

const TRANSITIONS: TransitionKind[] = ['none', 'fade', 'slide-left', 'slide-right', 'slide-up', 'slide-down', 'zoom'];

function transitionSection(clip: Clip): HTMLElement {
  const part = (which: 'enter' | 'exit', label: StringKey): HTMLElement[] => {
    const cur = clip[which] ?? { kind: 'none' as TransitionKind, duration: 0.5 };
    const sel = h('select', {});
    for (const k of TRANSITIONS) sel.append(new Option(tr(`vdTr_${k.replace('-', '_')}` as StringKey), k, false, k === cur.kind));
    sel.addEventListener('change', () => {
      clip[which] = { kind: sel.value as TransitionKind, duration: cur.duration || 0.5 };
      commit();
    });
    return [
      field(label, sel),
      slider('vdTrDuration', 0.1, 2, 0.05, cur.duration || 0.5, (v) => (clip[which] = { kind: clip[which]?.kind ?? 'none', duration: v }), (v) => seconds(v)),
    ];
  };
  return section('vdTransitions', ...part('enter', 'vdEnter'), ...part('exit', 'vdExit'));
}

function filtersSection(clip: Clip): HTMLElement {
  return section(
    'vdFilters',
    animSlider(clip, 'brightness', 'vdBrightness', 0, 2, 0.01, pct),
    animSlider(clip, 'contrast', 'vdContrast', 0, 2, 0.01, pct),
    animSlider(clip, 'saturation', 'vdSaturation', 0, 2, 0.01, pct),
    animSlider(clip, 'grayscale', 'vdGrayscale', 0, 1, 0.01, pct),
    btn('btn', tr('vdResetFilters'), null, () => {
      delete clip.filters;
      if (clip.keyframes) for (const p of ['brightness', 'contrast', 'saturation', 'grayscale'] as const) delete clip.keyframes[p];
      commit();
    }),
  );
}

function frameSection(clip: Clip): HTMLElement {
  const f = clip.frame ?? null;
  return section(
    'vdFrame',
    segmented(
      'vdMask',
      [
        ['none', tr('vdMaskNone')],
        ['rounded', tr('vdMaskRounded')],
        ['circle', tr('vdMaskCircle')],
      ],
      clip.mask ?? 'none',
      (v) => (clip.mask = v as Clip['mask']),
    ),
    toggle('vdFrameOn', !!f, (on) => (clip.frame = on ? { padding: 0.06, radius: 0.03, shadow: true } : null)),
    f ? slider('vdPadding', 0, 0.3, 0.005, f.padding, (v) => (f.padding = v), pct) : null,
    f ? slider('vdRadius', 0, 0.25, 0.005, f.radius, (v) => (f.radius = v), pct) : null,
    f ? toggle('vdShadow', f.shadow, (on) => (f.shadow = on)) : null,
    h('p', { class: 'hint' }, tr('vdFrameHint')),
  );
}

function zoomSection(clip: Clip, media: MediaItem): HTMLElement {
  const t = tRelOf(clip);
  const zooms = clip.zooms ?? [];
  const current = zooms.find((z) => t >= z.t && t <= z.t + z.d);
  const list = h('ul', { class: 'vd-zoom-list' });
  zooms.forEach((z, i) => {
    const go = btn('btn', `${timecode(clip.start + z.t, true)} · ${z.scale.toFixed(1)}×`, null, () => player.seek(clip.start + z.t + Math.min(0.7, z.d / 2)));
    const del = btn('btn icon', tr('annDelete'), I.trash, () => {
      zooms.splice(i, 1);
      clip.zooms = zooms;
      commit();
    });
    list.append(h('li', {}, go, del));
  });
  const add = btn('btn', tr('vdZoomAdd'), I.plus, () => {
    const z: ZoomSegment = { t, d: Math.min(2, clipLength(clip) - t), x: 0.5, y: 0.5, scale: 1.8 };
    if (z.d < 0.3 || zooms.some((o) => z.t < o.t + o.d && z.t + z.d > o.t)) return toast(tr('vdZoomOverlap'), true);
    clip.zooms = [...zooms, z].sort((a, b) => a.t - b.t);
    commit();
  });
  const kids: Array<HTMLElement | null> = [list, add];
  if (current) {
    kids.push(
      slider('vdZoomScale', 1.1, 4, 0.05, current.scale, (v) => (current.scale = v), (v) => `${v.toFixed(2)}×`),
      slider('vdZoomX', 0, 1, 0.005, current.x, (v) => (current.x = v), pct),
      slider('vdZoomY', 0, 1, 0.005, current.y, (v) => (current.y = v), pct),
      slider('vdLength', 0.3, 15, 0.1, current.d, (v) => (current.d = Math.min(v, clipLength(clip) - current.t)), seconds),
    );
  }
  if (media.clicks?.length) {
    kids.push(
      btn('btn', tr('vdZoomAuto'), I.plus, () => {
        clip.zooms = autoZooms(clip, media);
        commit();
        toast(tr('vdZoomAutoDone', { n: clip.zooms.length }));
      }),
      toggle('vdClicks', !!clip.clicks, (on) => (clip.clicks = on)),
    );
  }
  kids.push(h('p', { class: 'hint' }, tr('vdZoomHint')));
  return section('vdZooms', ...kids);
}

function soundSection(clip: Clip): HTMLElement {
  return section(
    'vdSound',
    animSlider(clip, 'volume', 'vdVolume', 0, 2, 0.01, pct),
    slider('vdFadeIn', 0, 5, 0.05, clip.fadeIn ?? 0, (v) => (clip.fadeIn = v), seconds),
    slider('vdFadeOut', 0, 5, 0.05, clip.fadeOut ?? 0, (v) => (clip.fadeOut = v), seconds),
  );
}

function textSection(clip: Clip): HTMLElement {
  const t = clip.text!;
  const area = h('textarea', { spellcheck: 'false' });
  area.value = t.content;
  area.addEventListener('input', () => {
    t.content = area.value;
    player.setProject(project);
  });
  area.addEventListener('change', commit);
  area.addEventListener('keydown', (e) => e.stopPropagation());
  return section(
    'vdText',
    field('vdTextContent', area),
    slider('vdTextSize', 0.02, 0.3, 0.002, t.size, (v) => (t.size = v), (v) => `${Math.round(v * 1000) / 10} %`),
    colorField('annColor', t.color, (v) => (t.color = v)),
    toggle('vdTextBold', t.bold, (on) => (t.bold = on)),
    segmented(
      'vdTextAlign',
      [
        ['left', tr('vdAlignLeft')],
        ['center', tr('vdAlignCenter')],
        ['right', tr('vdAlignRight')],
      ],
      t.align,
      (v) => (t.align = v as TextStyle['align']),
    ),
    toggle('vdTextBg', !!t.background, (on) => (t.background = on ? '#000000cc' : null)),
    t.background ? colorField('vdTextBgColor', t.background.slice(0, 7), (v) => (t.background = `${v}cc`)) : null,
    ...boxSliders(clip),
  );
}

function shapeSection(clip: Clip): HTMLElement {
  const s = clip.shape!;
  return section(
    'vdShape',
    segmented(
      'vdShapeKind',
      [
        ['rect', tr('annRect')],
        ['ellipse', tr('annEllipse')],
        ['arrow', tr('annArrow')],
      ],
      s.kind,
      (v) => (s.kind = v as ShapeStyle['kind']),
    ),
    colorField('annColor', s.color, (v) => (s.color = v)),
    slider('annWidth', 0.002, 0.05, 0.001, s.width, (v) => (s.width = v), (v) => `${Math.round(v * 1000) / 10} %`),
    s.kind !== 'arrow' ? toggle('annFill', s.fill, (on) => (s.fill = on)) : null,
    ...boxSliders(clip),
  );
}

function effectSection(clip: Clip): HTMLElement {
  const e = clip.effect!;
  return section(
    'vdEffect',
    segmented(
      'vdEffectKind',
      [
        ['blur', tr('annBlur')],
        ['pixel', tr('annPixel')],
      ],
      e.kind,
      (v) => (e.kind = v as EffectStyle['kind']),
    ),
    slider('annStrength', 4, 80, 1, e.strength, (v) => (e.strength = v), (v) => String(Math.round(v))),
    ...boxSliders(clip),
    h('p', { class: 'hint' }, tr('vdEffectHint')),
  );
}

function clipLabel(clip: Clip): string {
  switch (typeOf(clip)) {
    case 'text':
      return clip.text?.content.split('\n')[0] || tr('annText');
    case 'shape':
      return tr(clip.shape?.kind === 'ellipse' ? 'annEllipse' : clip.shape?.kind === 'arrow' ? 'annArrow' : 'annRect');
    case 'effect':
      return tr(clip.effect?.kind === 'pixel' ? 'annPixel' : 'annBlur');
    default:
      return mediaOf(project, clip)?.name ?? '?';
  }
}

function renderInspector(): void {
  inspectorTime = player.time;
  const scroll = inspector.scrollTop;
  inspector.replaceChildren();
  const sel = selectedClip();
  if (!sel) {
    renderProjectSettings();
    inspector.scrollTop = scroll;
    return;
  }
  const { clip } = sel;
  const type = typeOf(clip);
  const media = type === 'media' ? mediaOf(project, clip) : undefined;
  inspector.append(
    h('h2', {}, clipLabel(clip)),
    h(
      'dl',
      { class: 'vd-facts' },
      h('dt', {}, tr('vdStart')),
      h('dd', {}, timecode(clip.start, true)),
      h('dt', {}, tr('vdLength')),
      h('dd', {}, seconds(clipLength(clip))),
    ),
  );
  if (media && media.kind !== 'image') {
    const speed = h('select', {});
    for (const v of [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]) speed.append(new Option(`${v}×`, String(v), false, v === clip.speed));
    speed.addEventListener('change', () => {
      clip.speed = Number(speed.value);
      commit();
    });
    inspector.append(field('vdSpeed', speed));
  }
  if (type !== 'media') inspector.append(transformSection(clip));
  if (type === 'text') inspector.append(textSection(clip));
  if (type === 'shape') inspector.append(shapeSection(clip));
  if (type === 'effect') inspector.append(effectSection(clip));
  if (media?.hasAudio) inspector.append(soundSection(clip));
  if (type === 'media' && media && media.kind !== 'audio') {
    const fit = segmented(
      'vdFit',
      [
        ['contain', tr('vdFitContain')],
        ['cover', tr('vdFitCover')],
        ['fill', tr('vdFitFill')],
      ],
      clip.fit,
      (v) => (clip.fit = v as Clip['fit']),
    );
    inspector.append(transformSection(clip, [fit]), frameSection(clip));
    if (media.kind === 'video') inspector.append(zoomSection(clip, media));
    inspector.append(filtersSection(clip), transitionSection(clip));
  } else if (type !== 'media' && type !== 'effect') {
    inspector.append(filtersSection(clip), transitionSection(clip));
  }
  inspector.append(
    h(
      'div',
      { class: 'vd-row-buttons' },
      btn('btn', `${tr('vdSplit')} (S)`, I.split, split),
      btn('btn danger', `${tr('annDelete')} (Suppr)`, I.trash, () => removeSelected(false)),
    ),
  );
  inspector.scrollTop = scroll;
}

function renderProjectSettings(): void {
  const sizes = new Map<string, string>();
  for (const m of project.media) {
    if (m.kind === 'audio' || !m.width) continue;
    const area = m.crop ?? { x: 0, y: 0, w: 1, h: 1 };
    sizes.set(`${even(m.width * area.w)}x${even(m.height * area.h)}`, m.name);
  }
  for (const s of ['1920x1080', '1280x720', '2560x1440', '1080x1920', '1080x1080']) if (!sizes.has(s)) sizes.set(s, '');
  const current = `${project.width}x${project.height}`;
  if (!sizes.has(current)) sizes.set(current, '');
  const size = h('select', {});
  for (const [s, from] of sizes) size.append(new Option(`${s.replace('x', ' × ')}${from ? ` (${from})` : ''}`, s, false, s === current));
  size.addEventListener('change', () => {
    const [w, hh] = size.value.split('x').map(Number);
    project.width = w;
    project.height = hh;
    commit();
  });
  const parts: Array<HTMLElement | null> = [
    h('h2', {}, tr('vdProject')),
    field('vdSize', size),
    segmented('vdFps', [['30', '30'], ['60', '60']], String(project.fps), (v) => (project.fps = v === '60' ? 60 : 30)),
    colorField('vdBackground', project.background, (v) => (project.background = v)),
    toggle('vdGradient', !!project.background2, (on) => (project.background2 = on ? '#8079c9' : null)),
    project.background2 ? colorField('vdBackground2', project.background2, (v) => (project.background2 = v)) : null,
    h('p', { class: 'hint' }, tr('vdKeysHint')),
  ];
  inspector.append(...parts.filter((x): x is HTMLElement => !!x));
}

function openExport(): void {
  if (duration(project) <= 0) return;
  player.pause();
  const short = Math.min(project.width, project.height);
  const format = h('select', {});
  format.append(new Option('MP4', 'mp4'), new Option(tr('vdGif'), 'gif'));
  const size = h('select', {});
  const fps = h('select', {});
  const target = h('select', {});
  const targetField = field('vdTarget', target);
  const fill = () => {
    const gif = format.value === 'gif';
    size.replaceChildren();
    fps.replaceChildren();
    if (gif) {
      for (const w of [320, 480, 640, 800]) if (w <= project.width) size.append(new Option(`${w} × ${Math.round((w * project.height) / project.width)}`, String(w / project.width), false, w === 480));
      if (!size.options.length) size.append(new Option(`${project.width} × ${project.height}`, '1'));
      for (const f of [10, 15, 20]) fps.append(new Option(String(f), String(f), false, f === 15));
    } else {
      size.append(new Option(`${project.width} × ${project.height}`, '1'));
      for (const [label, px] of [['1080p', 1080], ['720p', 720], ['480p', 480]] as const) if (px < short) size.append(new Option(label, String(px / short)));
      for (const f of [30, 60]) fps.append(new Option(String(f), String(f), false, f === project.fps));
    }
    targetField.hidden = gif;
  };
  target.append(new Option(tr('vdTargetNone'), ''));
  for (const mb of [8, 10, 25, 50, 100, 250]) target.append(new Option(`${mb} Mo`, String(mb)));
  fill();
  format.addEventListener('change', fill);
  const bar = h('div', {});
  const progress = h('div', { class: 'vd-progress' }, bar);
  progress.hidden = true;
  const note = h('p', { class: 'vd-note' }, tr('vdExportHint'));
  const start = btn('btn solid', tr('vdExportStart'), null, () => void run());
  const cancel = btn('btn', tr('capCancel'), null, () => {
    if (abort) abort.abort();
    else closeDialog();
  });
  const actions = h('div', { class: 'actions' }, cancel, start);
  let abort: AbortController | null = null;
  const selects = [format, size, fps, target];

  dialog(tr('vdExport'), [field('vdFormat', format), field('vdSize', size), field('vdFps', fps), targetField, note, progress], [actions]);

  async function run(): Promise<void> {
    abort = new AbortController();
    const k = Number(size.value);
    start.disabled = true;
    selects.forEach((s) => (s.disabled = true));
    progress.hidden = false;
    note.textContent = tr('vdExporting');
    const begun = performance.now();
    try {
      const opts = {
        width: project.width * k,
        height: project.height * k,
        fps: Number(fps.value),
        targetMB: format.value === 'mp4' && target.value ? Number(target.value) : null,
        signal: abort.signal,
        onProgress: (r: number) => {
          bar.style.width = `${Math.round(r * 100)}%`;
          const left = r > 0.02 ? ((performance.now() - begun) / r) * (1 - r) : 0;
          note.textContent = left ? tr('vdExportLeft', { s: Math.ceil(left / 1000) }) : tr('vdExporting');
        },
      };
      const res = format.value === 'gif' ? await exportGif(project, opts) : await exportProject(project, opts);
      abort = null;
      if (!res) throw new Error('empty');
      bar.style.width = '100%';
      showResult(res);
    } catch (err) {
      abort = null;
      const stopped = err instanceof DOMException && err.name === 'AbortError';
      note.textContent = stopped ? tr('vdExportCancelled') : tr('vdExportFailed');
      if (!stopped) console.error(err);
      start.disabled = false;
      selects.forEach((s) => (s.disabled = false));
    }
  }

  function showResult(res: { path: string; size: number }): void {
    note.textContent = tr('vdExportDone', { size: (res.size / 1024 / 1024).toFixed(1) });
    const out = (action: VideoOutputAction) => async () => {
      if (action === 'upload' && !hasKey) return toast(tr('annNoKey'), true);
      if (action === 'upload') toast(tr('annWorking'));
      const r = await call<UploadOutcome | { ok: boolean }>('output', { path: res.path, action });
      if (r.ok) toast(tr(action === 'upload' ? 'annUploaded' : action === 'save' ? 'annSaved' : action === 'copy' ? 'vdFileCopied' : 'vdOpened'));
      else if ('error' in r && r.error) toast(tr(IMAGE_ERRORS[r.error]), true);
    };
    actions.replaceChildren(
      btn('btn', tr('vdShowFolder'), I.folder, out('folder')),
      btn('btn', tr('annCopy'), I.copy, out('copy')),
      btn('btn', tr('annSave'), I.save, out('save')),
      btn('btn solid', tr('annUpload'), I.upload, out('upload')),
      btn('btn', tr('vdClose'), null, closeDialog),
    );
  }
}

function addGraphic(clip: Clip): void {
  const t = player.time;
  clip.start = t;
  const end = clipEnd(clip);
  const videos = project.tracks.filter((tr_) => tr_.kind === 'video').reverse();
  const free = (track: Track) => track.clips.every((c) => c.start >= end || clipEnd(c) <= t);
  let target = videos.length > 1 ? videos[0] : undefined;
  if (!target || !free(target)) {
    target = newTrack('video');
    const lastVideo = project.tracks.map((x) => x.kind).lastIndexOf('video');
    project.tracks.splice(lastVideo + 1, 0, target);
  }
  target.clips.push(clip);
  selectedId = clip.id;
  commit();
}

let preview: AudioContext | null = null;

async function openSounds(): Promise<void> {
  const grid = h('div', { class: 'vd-sounds' });
  for (const name of SOUNDS) {
    const label = tr(`vdSound_${name}` as StringKey);
    const play = btn('btn icon', tr('vdPlay'), I.play, async () => {
      preview ??= new AudioContext();
      const src = preview.createBufferSource();
      src.buffer = await makeSound(name);
      const gain = preview.createGain();
      gain.gain.value = 0.5;
      src.connect(gain).connect(preview.destination);
      src.start();
    });
    const add = btn('btn icon', tr('vdAddSound'), I.plus, async () => {
      const data = wav(await makeSound(name));
      const file = await call<{ path: string; url: string; name: string } | null>('saveSound', { name, data });
      if (!file) return;
      closeDialog();
      const [m] = await addMediaOnly([{ ...file, name: label }]);
      if (m) addClip(m, null, player.time);
    });
    grid.append(h('div', { class: 'row' }, h('span', {}, label), play, add));
  }
  dialog(tr('vdSounds'), [h('p', { class: 'vd-note' }, tr('vdSoundsHint')), grid], [btn('btn', tr('vdClose'), null, closeDialog)]);
}

let previewDrag: { clip: Clip; x: number; y: number; ox: number; oy: number } | null = null;

canvas.addEventListener('pointerdown', (e) => {
  const sel = selectedClip();
  if (!sel || sel.track.kind !== 'video' || e.button !== 0) return;
  const t = tRelOf(sel.clip);
  canvas.setPointerCapture(e.pointerId);
  previewDrag = { clip: sel.clip, x: e.clientX, y: e.clientY, ox: sample(sel.clip, 'x', t), oy: sample(sel.clip, 'y', t) };
});
canvas.addEventListener('pointermove', (e) => {
  if (!previewDrag) return;
  const r = canvas.getBoundingClientRect();
  const t = tRelOf(previewDrag.clip);
  setValue(previewDrag.clip, 'x', previewDrag.ox + (e.clientX - previewDrag.x) / r.width, t);
  setValue(previewDrag.clip, 'y', previewDrag.oy + (e.clientY - previewDrag.y) / r.height, t);
  player.setProject(project);
});
canvas.addEventListener('pointerup', () => {
  if (!previewDrag) return;
  previewDrag = null;
  commit();
});

function dialog(title: string, body: HTMLElement[], foot: HTMLElement[], wide = false): void {
  modal.replaceChildren(h('div', { class: `vd-dialog${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true' }, h('h2', {}, title), ...body, ...foot));
  modal.hidden = false;
}

function closeDialog(): void {
  modal.hidden = true;
  modal.replaceChildren();
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(document.documentElement.lang, { dateStyle: 'medium', timeStyle: 'short' });
}

async function showHome(recent?: ProjectSummary[]): Promise<void> {
  player.pause();
  const projects = recent ?? (await call<ProjectSummary[]>('projects'));
  const recs = await call<RecordingSummary[]>('recordings');
  const projectList = h('ul', { class: 'vd-list' });
  if (!projects.length) projectList.append(h('li', {}, h('p', { class: 'vd-note' }, tr('vdNoProjects'))));
  for (const p of projects) {
    const b = h('button', { type: 'button' }, h('span', {}, p.name), h('span', {}, formatDate(p.updated)));
    b.addEventListener('click', async () => {
      const full = await call<Project | null>('openProject', { id: p.id });
      if (full) openProject(full);
    });
    projectList.append(h('li', {}, b));
  }
  const recList = h('ul', { class: 'vd-list' });
  if (!recs.length) recList.append(h('li', {}, h('p', { class: 'vd-note' }, tr('vdNoRecordings'))));
  for (const r of recs) {
    const b = h('button', { type: 'button' }, h('span', {}, formatDate(r.created)), h('span', {}, timecode(r.duration)));
    b.addEventListener('click', async () => {
      const rec = await call<SessionMedia | null>('openRecording', { dir: r.dir });
      if (rec) await startFromRecording(rec);
    });
    recList.append(h('li', {}, b));
  }
  const fresh = btn('btn solid', tr('vdNewProject'), I.plus, () => {
    const p = newProject(tr('vdUntitled'));
    openProject(p);
    void call('saveProject', { project: p });
  });
  home.replaceChildren(
    h('h1', {}, tr('vdTitle')),
    h('p', {}, tr('vdHomeSub')),
    fresh,
    h(
      'div',
      { class: 'vd-home-cols' },
      h('section', { class: 'card pad' }, h('h2', { class: 'card-title' }, tr('vdRecentProjects')), projectList),
      h('section', { class: 'card pad' }, h('h2', { class: 'card-title' }, tr('vdRecordings')), recList),
    ),
  );
  home.hidden = false;
  document.body.classList.add('at-home');
}

async function startFromRecording(rec: SessionMedia): Promise<void> {
  toast(tr('vdLoading'));
  const p = await projectFromRecording(rec, `${tr('vdRecordingName')} ${formatDate(rec.session.created)}`, autoZoom);
  openProject(p);
  await call('saveProject', { project: p });
}

function buildTransport(): void {
  const step = (d: number) => () => player.seek(player.time + d);
  playBtn = btn('btn icon play solid', tr('vdPlay'), I.play, () => player.toggle(), `${tr('vdPlay')} (Space)`);
  $('transport').append(
    btn('btn icon', tr('vdToStart'), I.prev, () => player.seek(0), `${tr('vdToStart')} (Home)`),
    btn('btn icon', tr('vdFrameBack'), stroke('<path d="m15 6-6 6 6 6"/>'), () => step(-1 / project.fps)(), `${tr('vdFrameBack')} (←)`),
    playBtn,
    btn('btn icon', tr('vdFrameNext'), stroke('<path d="m9 6 6 6-6 6"/>'), () => step(1 / project.fps)(), `${tr('vdFrameNext')} (→)`),
    btn('btn icon', tr('vdToEnd'), I.next, () => player.seek(duration(project)), `${tr('vdToEnd')} (End)`),
    clock,
  );
  $('tl-bar').append(
    btn('btn', tr('vdSplit'), I.split, split, `${tr('vdSplit')} (S)`),
    btn('btn', tr('annDelete'), I.trash, () => removeSelected(false), `${tr('annDelete')} (Suppr), ${tr('vdRipple')} (Maj+Suppr)`),
    h('span', { class: 'sep' }),
    btn('btn', tr('annText'), stroke('<path d="M5 7V5h14v2M12 5v14M9 19h6"/>'), () => addGraphic(newTextClip(0, tr('vdTextDefault')))),
    btn('btn', tr('vdShapeBtn'), stroke('<rect x="4" y="6" width="16" height="12" rx="2"/>'), () => addGraphic(newShapeClip(0, 'rect'))),
    btn('btn', tr('vdBlurBtn'), stroke('<path d="M12 3c3.5 4.2 6 7.4 6 11a6 6 0 0 1-12 0c0-3.6 2.5-6.8 6-11z"/>'), () => addGraphic(newEffectClip(0, 'blur'))),
    h('span', { class: 'sep' }),
    btn('btn', tr('vdAddVideoTrack'), I.film, () => {
      project.tracks.push(newTrack('video'));
      project.tracks.sort((a, b) => (a.kind === b.kind ? 0 : a.kind === 'video' ? -1 : 1));
      commit();
    }),
    btn('btn', tr('vdAddAudioTrack'), I.music, () => {
      project.tracks.push(newTrack('audio'));
      commit();
    }),
    h('span', { class: 'spacer' }),
    btn('btn icon', tr('annZoomOut'), I.minus, () => timeline.zoom(0.7)),
    btn('btn icon', tr('annZoomIn'), I.plus, () => timeline.zoom(1.4)),
    btn('btn icon', tr('annFit'), I.fit, () => timeline.fit()),
  );
}

window.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  if (target.closest('input, select, textarea') || !modal.hidden || !home.hidden) {
    if (e.key === 'Escape' && !modal.hidden) closeDialog();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  const key = e.key.toLowerCase();
  if (ctrl && key === 'z' && !e.shiftKey) undo();
  else if (ctrl && (key === 'y' || (key === 'z' && e.shiftKey))) redo();
  else if (ctrl && key === 'e') openExport();
  else if (ctrl && key === 'i') void importFiles();
  else if (ctrl) return;
  else if (e.key === ' ') player.toggle();
  else if (key === 's') split();
  else if (e.key === 'Delete' || e.key === 'Backspace') removeSelected(e.shiftKey);
  else if (e.key === 'ArrowLeft') player.seek(player.time - (e.shiftKey ? 1 : 1 / project.fps));
  else if (e.key === 'ArrowRight') player.seek(player.time + (e.shiftKey ? 1 : 1 / project.fps));
  else if (e.key === 'Home') player.seek(0);
  else if (e.key === 'End') player.seek(duration(project));
  else if (e.key === 'Escape') timelineSelect(null);
  else return;
  e.preventDefault();
});

function timelineSelect(id: string | null): void {
  selectedId = id;
  renderAll();
}

window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (!e.dataTransfer?.types.includes('Files')) return;
  e.preventDefault();
  toast(tr('vdDropHint'));
});

async function main(): Promise<void> {
  const init = await desk.invoke<VideoInit>(CH.videoInit);
  setLocale(init.locale);
  void applyFont(init.font);
  hasKey = init.hasKey;
  autoZoom = init.autoZoom;
  setTextFamily(getComputedStyle(document.body).fontFamily);
  void document.fonts.ready.then(() => {
    setTextFamily(getComputedStyle(document.body).fontFamily);
    player.draw();
  });
  buildTop();
  buildTransport();
  if (init.project) openProject(init.project);
  else if (init.recording) await startFromRecording(init.recording);
  else {
    renderAll();
    await showHome(init.recent);
  }
}

void main();
