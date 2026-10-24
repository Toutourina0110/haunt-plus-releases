import { CH } from '../shared/channels';
import { palette } from '../shared/palette';
import { LANGUAGE_NAMES, LOCALES, type StringKey } from '../shared/i18n';
import { keyLabel } from '../shared/shortcuts';
import { DEFAULT_PARAMS } from '../shared/tile-params';
import type {
  LogoFile,
  MenuAction,
  PageShot,
  Settings,
  SettingsOpenPayload,
  SettingsPatch,
  TabId,
  TourStartPayload,
  TransitionPayload,
  UiInit,
  UpdateNoticePayload,
  UpdateStatus,
} from '../shared/types';
import {
  applyFont,
  applyPalette,
  desk,
  ICONS,
  iconButton,
  LOGOS,
  paintSettled,
  prefersReducedMotion,
  setLocale,
  siteName,
  tourLabels,
  tr,
} from './common';
import { loadMark, TileMorph, type Mark, type Shot } from './tiles';
import { rectOf, refreshTour, runTour, tourActive, type TourStep } from './tour';

const splash = document.getElementById('splash')!;
const fx = document.getElementById('fx') as HTMLCanvasElement;
const menu = document.getElementById('menu')!;
const settingsEl = document.getElementById('settings')!;
const backdrop = document.getElementById('settings-backdrop')!;
const panel = document.getElementById('settings-panel')!;

let dark = true;
let site: TabId = 'haunt';
let version = '';
let fontMissing = false;
let settings: Settings | null = null;
let update: UpdateStatus = { state: 'idle' };
let settingsOpen = false;
let noticeOpen = false;
let noticeGo = false;
let menuAnim: Animation | null = null;
let marks: Promise<Record<TabId, Mark> | null> = Promise.resolve(null);

let current: { aborted: boolean; stop: () => void } | null = null;
let onTarget: ((shot: Shot | null) => void) | null = null;

const OUT_EASE = 'cubic-bezier(0.22, 1, 0.36, 1)';

function setSite(next: TabId): void {
  site = next;
  applyPalette(site, dark);
}

function loadMarks(files: Record<TabId, LogoFile> | undefined): void {
  if (!files) return;
  const load = (f: LogoFile) => loadMark(new Blob([f.bytes as BlobPart], { type: f.type }));
  marks = Promise.all([load(files.haunt), load(files.tools), load(files.images)])
    .then(([haunt, tools, images]) => ({ haunt, tools, images }))
    .catch((err) => {
      console.error('Logo sampling failed, falling back to the simple transition:', err);
      return null;
    });
}

async function toShot(shot: PageShot | null): Promise<Shot | null> {
  if (!shot) return null;
  const bitmap = await createImageBitmap(new Blob([shot.jpeg as BlobPart], { type: 'image/jpeg' })).catch(() => null);
  return { bitmap, boxes: shot.boxes };
}

function abortTransition(): void {
  if (!current || current.aborted) return;
  current.aborted = true;
  current.stop();
}

async function runTransition(payload: TransitionPayload): Promise<void> {
  menu.hidden = true;
  if (payload.kind === 'switch' && settingsOpen) void closeSettings(false);
  const run = { aborted: false, stop: () => {} };
  current = run;
  const shots: Shot[] = [];
  const keep = (shot: Shot | null) => {
    if (shot) shots.push(shot);
    return shot;
  };

  try {
    const all = await marks;
    const full = !prefersReducedMotion() && payload.mode === 'full' && !!all;
    if (payload.kind === 'intro') {
      if (!payload.to) return;
      if (full) await tiles(payload, run, all!, keep);
      else await fadeSplash(run);
    } else if (full) {
      await tiles(payload, run, all!, keep);
    } else {
      await fadeOut(payload, run, keep);
    }
  } finally {
    onTarget = null;
    current = null;
    for (const shot of shots) shot.bitmap?.close();
    fx.getContext('2d')?.clearRect(0, 0, fx.width, fx.height);
    fx.hidden = true;
    fx.getAnimations().forEach((a) => a.cancel());
    splash.hidden = true;
    setSite(payload.toSite);
    desk.send(CH.overlayDone);
  }
}

async function tiles(
  payload: TransitionPayload,
  run: { aborted: boolean; stop: () => void },
  all: Record<TabId, Mark>,
  keep: (shot: Shot | null) => Shot | null,
): Promise<void> {
  const fromSite = payload.fromSite ?? payload.toSite;
  const from = keep(await toShot(payload.from));
  fx.hidden = false;
  const morph = new TileMorph({
    kind: payload.kind,
    canvas: fx,
    from: { mark: all[fromSite], bg: palette(fromSite, dark).bg, shot: from },
    to: { mark: all[payload.toSite], bg: palette(payload.toSite, dark).bg },
    dark,
    params: { ...DEFAULT_PARAMS, duration: payload.duration },
    sweepRight: payload.toSite === 'tools',
  });
  run.stop = () => morph.abort();
  morph.drawStart();
  await paintSettled();
  splash.hidden = true;
  onTarget = (shot) => morph.setTarget(keep(shot));
  desk.send(CH.overlayCovered);
  if (payload.kind === 'intro') morph.setTarget(keep(await toShot(payload.to)));
  if (run.aborted) morph.abort();
  await morph.play();
}

async function fadeOut(
  payload: TransitionPayload,
  run: { aborted: boolean; stop: () => void },
  keep: (shot: Shot | null) => Shot | null,
): Promise<void> {
  const from = keep(await toShot(payload.from));
  const dpr = window.devicePixelRatio || 1;
  fx.width = Math.round(fx.clientWidth * dpr) || Math.round(window.innerWidth * dpr);
  fx.height = Math.round(fx.clientHeight * dpr) || Math.round(window.innerHeight * dpr);
  fx.hidden = false;
  const ctx = fx.getContext('2d')!;
  ctx.fillStyle = palette(payload.fromSite ?? payload.toSite, dark).bg;
  ctx.fillRect(0, 0, fx.width, fx.height);
  if (from?.bitmap) ctx.drawImage(from.bitmap, 0, 0, fx.width, fx.height);
  await paintSettled();

  const swapped = new Promise<void>((resolve) => {
    onTarget = () => resolve();
    run.stop = () => resolve();
    window.setTimeout(resolve, 1500);
  });
  desk.send(CH.overlayCovered);
  await swapped;
  if (run.aborted) return;
  const anim = fx.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
  run.stop = () => anim.finish();
  await anim.finished.catch(() => {});
}

async function fadeSplash(run: { aborted: boolean; stop: () => void }): Promise<void> {
  const anim = splash.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 220, easing: 'ease-out', fill: 'forwards' });
  run.stop = () => anim.finish();
  await anim.finished.catch(() => {});
  anim.cancel();
}

function buildMenu(): void {
  const ctrl = keyLabel('Control', document.documentElement.lang);
  const items: Array<{ act: MenuAction; label: string; html: string; className?: string } | 'rule'> = [
    { act: 'haunt', label: `${siteName('haunt')}  (${ctrl}+1)`, html: `<img src="${LOGOS.haunt}" alt="">` },
    { act: 'tools', label: `${siteName('tools')}  (${ctrl}+2)`, html: `<img src="${LOGOS.tools}" alt="">` },
    { act: 'images', label: `${siteName('images')}  (${ctrl}+3)`, html: `<img src="${LOGOS.images}" alt="">` },
    'rule',
    { act: 'settings', label: `${tr('settings')}  (${ctrl}+,)`, html: ICONS.gear },
    { act: 'hauntplus', label: tr('hauntPlusTheme'), html: ICONS.plus, className: 'plus' },
  ];
  for (const item of items) {
    if (item === 'rule') {
      menu.append(Object.assign(document.createElement('hr'), { className: 'menu-rule' }));
      continue;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `menu-btn ${item.className ?? ''}`.trim();
    button.dataset.act = item.act;
    button.title = item.label;
    button.setAttribute('aria-label', item.label);
    button.innerHTML = item.html;
    button.addEventListener('click', () => desk.send(CH.menuAction, item.act));
    menu.append(button);
  }
}

function showMenu(data: { active: TabId; hauntPlus: boolean }): void {
  splash.hidden = true;
  setSite(data.active);
  for (const button of menu.querySelectorAll<HTMLButtonElement>('.menu-btn')) {
    const act = button.dataset.act;
    button.setAttribute('aria-current', String(act === data.active));
    if (act === 'hauntplus') button.hidden = !data.hauntPlus;
  }
  menuAnim?.cancel();
  menu.hidden = false;
  menuAnim = menu.animate(
    [
      { opacity: 0, transform: 'translate(14px, -50%)' },
      { opacity: 1, transform: 'translate(0, -50%)' },
    ],
    { duration: prefersReducedMotion() ? 0 : 180, easing: OUT_EASE },
  );
}

function hideMenu(): void {
  if (menu.hidden) return;
  menuAnim?.cancel();
  menuAnim = menu.animate(
    [
      { opacity: 1, transform: 'translate(0, -50%)' },
      { opacity: 0, transform: 'translate(14px, -50%)' },
    ],
    { duration: prefersReducedMotion() ? 0 : 140, easing: 'ease-in', fill: 'forwards' },
  );
  const anim = menuAnim;
  anim.finished
    .then(() => {
      if (menuAnim === anim) menu.hidden = true;
    })
    .catch(() => {});
}

let tourData: TourStartPayload | null = null;

function showMenuNow(): void {
  if (!tourData) return;
  setSite(tourData.active);
  for (const button of menu.querySelectorAll<HTMLButtonElement>('.menu-btn')) {
    button.setAttribute('aria-current', String(button.dataset.act === tourData.active));
    if (button.dataset.act === 'hauntplus') button.hidden = !tourData.hauntPlus;
  }
  menuAnim?.cancel();
  menu.hidden = false;
}

function startWindowTour(): void {
  menu.hidden = true;
  splash.hidden = true;
  const bar = (key: keyof TourStartPayload['rects']) => ({
    available: () => !!tourData?.rects[key],
    target: () => tourData?.rects[key] ?? null,
    bounds: () => {
      const t = tourData?.titlebar;
      return t ? { x: t.x, y: 0, w: t.w, h: window.innerHeight } : null;
    },
  });
  const inMenu = { enter: showMenuNow, leave: () => (menu.hidden = true) };
  const steps: TourStep[] = [
    { title: tr('tw0T'), text: tr('tw0') },
    { title: tr('tw1T'), text: tr('tw1'), ...bar('switch') },
    { title: tr('tw2T'), text: tr('tw2'), ...bar('nav') },
    { title: tr('tw3T'), text: tr('tw3'), ...bar('copy') },
    { title: tr('tw4T'), text: tr('tw4'), ...inMenu, target: () => rectOf(menu) },
    { title: tr('tw5T'), text: tr('tw5'), ...inMenu, target: () => rectOf(menu.querySelector('[data-act="settings"]')) },
    { title: tr('tw6T'), text: tr('tw6'), ...bar('help') },
    { title: tr('tw7T'), text: tr('tw7') },
  ];
  void runTour(steps, tourLabels()).then(() => {
    menu.hidden = true;
    desk.send(CH.tourDone);
  });
}

function textBlock(label: StringKey, hint?: StringKey): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'sp-text';
  const l = document.createElement('span');
  l.className = 'sp-label';
  l.textContent = tr(label);
  wrap.append(l);
  if (hint) {
    const h = document.createElement('span');
    h.className = 'sp-hint';
    h.textContent = tr(hint);
    wrap.append(h);
  }
  return wrap;
}

function group(title: StringKey, ...children: HTMLElement[]): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sp-group';
  const h = document.createElement('h3');
  h.textContent = tr(title);
  section.append(h, ...children);
  return section;
}

type BoolKey = 'openAtLogin' | 'closeToTray' | 'hauntPlus' | 'globalShortcut';

function toggleRow(key: BoolKey, label: StringKey, hint?: StringKey): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sp-row';
  const text = textBlock(label, hint);
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'toggle';
  toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-label', tr(label));
  toggle.dataset.key = key;
  toggle.addEventListener('click', () => {
    if (!settings) return;
    const next = toggle.getAttribute('aria-checked') !== 'true';
    toggle.setAttribute('aria-checked', String(next));
    change({ [key]: next });
  });
  row.append(text, toggle);
  return row;
}

type ChoiceKey = 'startPage' | 'animations' | 'externalLinks' | 'transitionSpeed';

function choice(key: ChoiceKey, label: StringKey, options: Array<[string, string]>): HTMLElement {
  const seg = document.createElement('div');
  seg.className = 'seg';
  seg.setAttribute('role', 'radiogroup');
  seg.setAttribute('aria-label', tr(label));
  seg.dataset.key = key;
  seg.style.setProperty('--count', String(options.length));
  const pill = document.createElement('span');
  pill.className = 'seg-pill';
  seg.append(pill);
  options.forEach(([value, text], index) => {
    const opt = document.createElement('button');
    opt.type = 'button';
    opt.className = 'seg-opt';
    opt.setAttribute('role', 'radio');
    opt.dataset.value = value;
    opt.dataset.index = String(index);
    opt.textContent = text;
    opt.addEventListener('click', () => {
      selectChoice(seg, value);
      change({ [key]: value } as SettingsPatch);
    });
    seg.append(opt);
  });
  return seg;
}

function selectChoice(seg: HTMLElement, value: string): void {
  for (const opt of seg.querySelectorAll<HTMLButtonElement>('.seg-opt')) {
    const on = opt.dataset.value === value;
    opt.setAttribute('aria-checked', String(on));
    if (on) seg.style.setProperty('--index', opt.dataset.index ?? '0');
  }
}

function change(patch: SettingsPatch): void {
  if (!settings) return;
  settings = { ...settings, ...patch };
  desk.send(CH.settingsSet, patch);
}

function shortcutList(): HTMLElement {
  const rows: Array<[string, StringKey]> = [
    ['Control+1', 'scSwitchHaunt'],
    ['Control+2', 'scSwitchTools'],
    ['Control+3', 'scSwitchImages'],
    ['Control+Tab', 'scToggle'],
    ['Alt+← / →', 'scHistory'],
    ['Control+R', 'scReload'],
    ['Control+Shift+C', 'scCopy'],
    ['Control+S', 'scSettings'],
    ['Control+L', 'scAddress'],
    ['Control+Shift+H', 'scHauntPlus'],
  ];
  const list = document.createElement('dl');
  list.className = 'keys';
  const lang = document.documentElement.lang;
  for (const [combo, desc] of rows) {
    const dt = document.createElement('dt');
    combo.split('+').forEach((k, i) => {
      if (i > 0) dt.append(' + ');
      const kbd = document.createElement('kbd');
      kbd.textContent = keyLabel(k, lang);
      dt.append(kbd);
    });
    const dd = document.createElement('dd');
    dd.textContent = tr(desc);
    list.append(dt, dd);
  }
  return list;
}

let clearArmed = 0;

function buildSettings(): void {
  const head = document.createElement('header');
  head.className = 'sp-head';
  const title = document.createElement('h2');
  title.id = 'settings-title';
  title.textContent = tr('settings');
  const close = iconButton('settings-close', 'close', tr('close'));
  close.addEventListener('click', () => closeSettings(true));
  head.append(title, close);

  const body = document.createElement('div');
  body.className = 'sp-body';

  const sites: Array<[string, string]> = [
    ['haunt', siteName('haunt')],
    ['tools', siteName('tools')],
    ['images', siteName('images')],
    ['last', tr('startLast')],
  ];

  const startLabel = textBlock('startPage');
  startLabel.classList.add('sp-row');
  body.append(
    group('startup', toggleRow('openAtLogin', 'openAtLogin'), startLabel, choice('startPage', 'startPage', sites)),
    group('closing', toggleRow('closeToTray', 'closeToTray', 'closeToTrayHint')),
    group(
      'links',
      wrapText('linksHint'),
      choice('externalLinks', 'links', [
        ['popup', tr('linksPopup')],
        ['browser', tr('linksBrowser')],
      ]),
    ),
    group(
      'animations',
      choice('animations', 'animations', [
        ['full', tr('animFull')],
        ['simple', tr('animSimple')],
        ['off', tr('animOff')],
      ]),
      labelRow('transitionSpeed', 'transitionSpeedHint'),
      choice('transitionSpeed', 'transitionSpeed', [
        ['fast', tr('speedFast')],
        ['medium', tr('speedMedium')],
        ['long', tr('speedLong')],
      ]),
    ),
    group(
      'appearance',
      labelRow('language', 'languageHint'),
      languagePicker(),
      labelRow('font', 'fontHint'),
      fontField(),
    ),
    group('hauntPlus', toggleRow('hauntPlus', 'hauntPlusToggle', 'hauntPlusHint'), hauntPlusActions()),
    group('shortcuts', toggleRow('globalShortcut', 'globalShortcut', 'globalShortcutHint'), shortcutList()),
    group('data', clearRow()),
    aboutGroup(),
  );

  panel.tabIndex = -1;
  panel.append(head, body);
  backdrop.addEventListener('click', () => closeSettings(true));
}

function languagePicker(): HTMLElement {
  const select = document.createElement('select');
  select.className = 'sp-select';
  select.id = 'language';
  select.setAttribute('aria-label', tr('language'));
  select.append(new Option(tr('langAuto'), 'auto'), ...LOCALES.map((l) => new Option(LANGUAGE_NAMES[l], l)));
  select.addEventListener('change', () => change({ language: select.value as Settings['language'] }));
  return select;
}

function fontField(): HTMLElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'sp-select';
  input.id = 'font';
  input.placeholder = 'Average Sans';
  input.maxLength = 60;
  input.pattern = '[A-Za-z0-9 ]*';
  input.spellcheck = false;
  input.setAttribute('aria-label', tr('font'));
  input.addEventListener('change', () => {
    const name = input.value.trim().replace(/ +/g, ' ');
    if (input.checkValidity() && name !== settings?.font) change({ font: name });
  });
  const missing = document.createElement('span');
  missing.className = 'sp-hint sp-bad';
  missing.id = 'font-missing';
  missing.textContent = tr('fontMissing');
  missing.hidden = true;
  const wrap = document.createElement('div');
  wrap.append(input, missing);
  return wrap;
}

function labelRow(label: StringKey, hint: StringKey): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sp-row';
  row.append(textBlock(label, hint));
  return row;
}

function wrapText(hint: StringKey): HTMLElement {
  const p = document.createElement('div');
  p.className = 'sp-row';
  const span = document.createElement('span');
  span.className = 'sp-hint';
  span.style.marginTop = '0';
  span.textContent = tr(hint);
  p.append(span);
  return p;
}

function hauntPlusActions(): HTMLElement {
  const actions = document.createElement('div');
  actions.className = 'sp-actions';
  const open = document.createElement('button');
  open.type = 'button';
  open.className = 'btn';
  open.id = 'hauntplus-open';
  open.textContent = tr('hauntPlusOpen');
  open.addEventListener('click', async () => {
    await closeSettings(true);
    desk.send(CH.menuAction, 'hauntplus');
  });
  actions.append(open);
  return actions;
}

function clearRow(): HTMLElement {
  const row = document.createElement('div');
  row.className = 'sp-row';
  const text = textBlock('clearData', 'clearDataHint');
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn danger';
  button.id = 'clear-data';
  button.textContent = tr('clearData');
  text.querySelector('.sp-label')!.remove();
  button.addEventListener('click', () => {
    if (!clearArmed) {
      button.dataset.armed = '1';
      button.textContent = tr('clearDataArmed');
      clearArmed = window.setTimeout(resetClear, 6000);
      return;
    }
    window.clearTimeout(clearArmed);
    clearArmed = 0;
    button.disabled = true;
    desk.send(CH.clearData);
  });
  row.append(text, button);
  return row;
}

function resetClear(): void {
  clearArmed = 0;
  const button = document.getElementById('clear-data') as HTMLButtonElement | null;
  if (!button) return;
  button.dataset.armed = '0';
  button.disabled = false;
  button.textContent = tr('clearData');
}

function aboutGroup(): HTMLElement {
  const section = document.createElement('section');
  section.className = 'sp-group about';
  section.innerHTML = '<div><strong id="about-version"></strong><span id="about-status"></span></div>';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'btn';
  button.id = 'update-btn';
  button.addEventListener('click', () => {
    if (update.state === 'ready') desk.send(CH.updateInstall);
    else desk.send(CH.updateCheck);
  });
  section.append(button);
  return section;
}

function openNotice(data: UpdateNoticePayload): void {
  update = data.update;
  noticeOpen = true;
  noticeGo = false;
  const title = document.getElementById('notice-title');
  const body = document.getElementById('notice-body');
  if (title) title.textContent = tr('noticeTitle', { v: data.version });
  if (body) body.textContent = data.message || tr('noticeBody');
  document.getElementById('notice')!.hidden = false;
  renderNotice();
  document.getElementById('notice-go')?.focus();
}

function closeNotice(): void {
  if (!noticeOpen) return;
  noticeOpen = false;
  document.getElementById('notice')!.hidden = true;
  desk.send(CH.updateNoticeClosed);
}

function renderNotice(): void {
  if (!noticeOpen) return;
  const go = document.getElementById('notice-go') as HTMLButtonElement | null;
  const later = document.getElementById('notice-later') as HTMLButtonElement | null;
  const progress = document.getElementById('notice-progress');
  if (!go || !later || !progress) return;
  const ready = update.state === 'ready';
  if (noticeGo && ready) {
    go.textContent = tr('noticeRestart');
    go.disabled = true;
    later.hidden = true;
    progress.hidden = true;
    desk.send(CH.updateInstall);
    return;
  }
  if (noticeGo && update.state === 'error') noticeGo = false;
  const waiting = noticeGo && !ready;
  go.textContent = tr('noticeUpdate');
  go.disabled = waiting;
  later.textContent = tr('noticeLater');
  later.hidden = waiting;
  progress.hidden = !waiting;
  progress.textContent = update.state === 'downloading' ? tr('updateDownloading', { p: update.percent ?? 0 }) : tr('updateChecking');
  if (waiting && update.state !== 'downloading' && update.state !== 'checking') desk.send(CH.updateCheck);
}

function renderUpdate(): void {
  const status = document.getElementById('about-status');
  const button = document.getElementById('update-btn') as HTMLButtonElement | null;
  const versionEl = document.getElementById('about-version');
  if (!status || !button || !versionEl) return;
  versionEl.textContent = tr('version', { v: version });

  const text: Record<UpdateStatus['state'], string> = {
    dev: tr('updateDev'),
    idle: '',
    checking: tr('updateChecking'),
    none: tr('updateNone'),
    downloading: tr('updateDownloading', { p: update.percent ?? 0 }),
    ready: tr('updateReady', { v: update.version ?? '' }),
    error: tr('updateError'),
  };
  status.textContent = text[update.state];
  button.hidden = update.state === 'dev' || update.state === 'downloading';
  button.disabled = update.state === 'checking';
  button.classList.toggle('primary', update.state === 'ready');
  button.textContent = update.state === 'ready' ? tr('updateInstall') : tr('updateCheck');
}

function renderSettings(): void {
  if (!settings) return;
  for (const toggle of panel.querySelectorAll<HTMLButtonElement>('.toggle')) {
    const key = toggle.dataset.key as BoolKey;
    toggle.setAttribute('aria-checked', String(settings[key]));
  }
  for (const seg of panel.querySelectorAll<HTMLElement>('.seg')) {
    const key = seg.dataset.key as ChoiceKey;
    selectChoice(seg, settings[key]);
  }
  const speed = panel.querySelector<HTMLElement>('.seg[data-key="transitionSpeed"]');
  if (speed) {
    const off = settings.animations !== 'full';
    speed.setAttribute('aria-disabled', String(off));
    speed.querySelectorAll('button').forEach((b) => (b.disabled = off));
  }
  const language = document.getElementById('language') as HTMLSelectElement | null;
  if (language) language.value = settings.language;
  const font = document.getElementById('font') as HTMLInputElement | null;
  if (font && document.activeElement !== font) font.value = settings.font;
  const missing = document.getElementById('font-missing');
  if (missing) missing.hidden = !fontMissing;
  const open = document.getElementById('hauntplus-open') as HTMLButtonElement | null;
  if (open) open.disabled = !settings.hauntPlus;
  renderUpdate();
}

function openSettings(payload: SettingsOpenPayload): void {
  menu.hidden = true;
  splash.hidden = true;
  settings = payload.settings;
  update = payload.update;
  resetClear();
  renderSettings();
  backdrop.style.setProperty('--shot', payload.snapshot ? `url("${payload.snapshot}")` : 'none');
  settingsEl.hidden = false;
  settingsOpen = true;
  const fast = prefersReducedMotion() || settings.animations === 'off';
  backdrop.animate([{ opacity: 0 }, { opacity: 1 }], { duration: fast ? 0 : 220, easing: 'ease-out' });
  panel.animate(
    [
      { opacity: 0, transform: 'translateX(28px)' },
      { opacity: 1, transform: 'none' },
    ],
    { duration: fast ? 0 : 260, easing: OUT_EASE },
  );
  panel.focus();
}

async function closeSettings(animated: boolean, notify = true): Promise<void> {
  if (!settingsOpen) return;
  settingsOpen = false;
  const fast = !animated || prefersReducedMotion() || settings?.animations === 'off';
  const anims = [
    backdrop.animate([{ opacity: 1 }, { opacity: 0 }], { duration: fast ? 0 : 200, easing: 'ease-in', fill: 'forwards' }),
    panel.animate(
      [
        { opacity: 1, transform: 'none' },
        { opacity: 0, transform: 'translateX(28px)' },
      ],
      { duration: fast ? 0 : 180, easing: 'ease-in', fill: 'forwards' },
    ),
  ];
  await Promise.allSettled(anims.map((a) => a.finished));
  settingsEl.hidden = true;
  anims.forEach((a) => a.cancel());
  backdrop.style.setProperty('--shot', 'none');
  if (notify) desk.send(CH.settingsClosed);
}

async function main(): Promise<void> {
  const init = await desk.invoke<UiInit>(CH.init);
  setLocale(init.locale);
  void applyFont(init.settings.font).then((ok) => {
    fontMissing = !ok;
    const missing = document.getElementById('font-missing');
    if (missing) missing.hidden = ok;
  });
  dark = init.dark;
  version = init.version;
  settings = init.settings;
  setSite(init.site);
  loadMarks(init.marks);
  buildMenu();
  buildSettings();

  desk.on<TransitionPayload>(CH.transition, (payload) => void runTransition(payload));
  desk.on<{ to: PageShot | null }>(CH.transitionPlay, async (data) => {
    const take = onTarget;
    if (!take) return;
    const shot = await toShot(data?.to ?? null);
    if (onTarget === take) take(shot);
    else shot?.bitmap?.close();
  });
  desk.on(CH.transitionAbort, abortTransition);
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, abortTransition);
  desk.on<{ active: TabId; hauntPlus: boolean }>(CH.menuShow, showMenu);
  desk.on(CH.menuHide, hideMenu);
  desk.on<TourStartPayload>(CH.tourStart, (data) => {
    tourData = data;
    if (tourActive()) refreshTour();
    else startWindowTour();
  });
  desk.on<SettingsOpenPayload>(CH.settingsOpen, openSettings);
  desk.on(CH.settingsClose, () => void closeSettings(false));
  desk.on<Settings>(CH.settingsChanged, (next) => {
    settings = next;
    renderSettings();
  });
  desk.on<UpdateStatus>(CH.updateStatus, (next) => {
    update = next;
    renderUpdate();
    renderNotice();
  });
  desk.on<UpdateNoticePayload>(CH.updateNotice, openNotice);
  document.getElementById('notice-go')?.addEventListener('click', () => {
    noticeGo = true;
    renderNotice();
  });
  document.getElementById('notice-later')?.addEventListener('click', closeNotice);
  desk.on(CH.dataCleared, () => {
    const button = document.getElementById('clear-data') as HTMLButtonElement | null;
    if (!button) return;
    button.dataset.armed = '0';
    button.textContent = tr('clearDataDone');
    window.setTimeout(resetClear, 2000);
  });
  desk.on<{ dark: boolean }>(CH.theme, (theme) => {
    dark = theme.dark;
    applyPalette(site, dark);
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsOpen) void closeSettings(true);
    else if (event.key === 'Escape' && noticeOpen && !noticeGo) closeNotice();
  });

  await paintSettled();
  desk.send(CH.overlayReady);
}

void main();
