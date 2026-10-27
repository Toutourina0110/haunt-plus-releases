import { CH } from '../shared/channels';
import { palette } from '../shared/palette';
import { LANGUAGE_NAMES, LOCALES, type StringKey } from '../shared/i18n';
import { keyLabel } from '../shared/shortcuts';
import { DEFAULT_PARAMS } from '../shared/tile-params';
import {
  isGlMode,
  isStageMode,
  type AnimationMode,
  type LogoFile,
  type MenuAction,
  type PageShot,
  type Settings,
  type SettingsOpenPayload,
  type SettingsPatch,
  type TabId,
  type TourStartPayload,
  type TransitionChainPayload,
  type TransitionPayload,
  type TransitionPlayPayload,
  type UiInit,
  type UpdateNoticePayload,
  type UpdateStatus,
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
import { GlEngine } from './motion/gl/engine';
import { scenes, warm } from './motion/gl';
import { GlMorph } from './motion/gl/morph';
import { executionCues, prepareExecution } from './motion/execution';
import { EXECUTION } from './motion/execution-params';
import { ExecutionSfx } from './motion/execution-sfx';
import { Preview, type PreviewEnv } from './motion/preview';
import { Stage, type Leg, type Picture } from './motion/stage';
import { decodeShot, loadMark, sampleCells, TileMorph, type Mark, type Shot } from './tiles';
import { DUST } from '../shared/dust-params';
import { rectOf, refreshTour, runTour, tourActive, type TourStep } from './tour';

const splash = document.getElementById('splash')!;
const fx = document.getElementById('fx') as HTMLCanvasElement;
const glCanvas = document.getElementById('gl') as HTMLCanvasElement;
let glEngine: GlEngine | null | undefined;
function gl(): GlEngine | null {
  if (glEngine === undefined) {
    glEngine = GlEngine.create(glCanvas);
    if (glEngine) warm(glEngine);
  }
  return glEngine?.ok ? glEngine : null;
}

function prepareGl(): void {
  requestIdleCallback(() => void marks.then((all) => all && prepareExecution(all)));
  if (!settings || !isGlMode(settings.animations)) return;
  requestIdleCallback(() => {
    gl();
    void marks.then((all) => all && Object.values(all).forEach((mark) => sampleCells(mark, DUST.dark.logoCells)));
  });
}
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

type OverlayRun = { aborted: boolean; stop: () => void; site: TabId };
let current: OverlayRun | null = null;
let onTarget: ((shot: Shot | null) => void) | null = null;

const cache = new Map<TabId, Picture>();
const stage = new Stage(document.getElementById('stage')!, {
  dark: () => dark,
  colors: (tab) => {
    const p = palette(tab, dark);
    return { stage: p.raised, surface: p.surface };
  },
});

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

async function take(tab: TabId, shot: PageShot | null): Promise<Picture | null> {
  const decoded = await decodeShot(shot);
  if (!decoded) return null;
  const pic: Picture = { ...decoded, cards: shot?.cards ?? [] };
  if (pic.bitmap) {
    const old = cache.get(tab);
    cache.set(tab, pic);
    if (old && old !== pic) old.bitmap?.close();
  }
  return pic;
}

function abortTransition(): void {
  if (!current || current.aborted) return;
  current.aborted = true;
  current.stop();
}

async function runTransition(payload: TransitionPayload): Promise<void> {
  menu.hidden = true;
  if (payload.kind === 'switch' && settingsOpen) void closeSettings(false);
  const run: OverlayRun = { aborted: false, stop: () => {}, site: payload.toSite };
  current = run;

  try {
    const all = await marks;
    const glMode = isGlMode(payload.mode);
    const full = !prefersReducedMotion() && (payload.mode === 'full' || glMode) && !!all;
    if (payload.kind === 'intro') {
      if (!payload.to) return;
      if (full) await tiles(payload, run, all!);
      else await fadeSplash(run);
    } else if (full && glMode && gl()) {
      await glSwitch(payload, run, all!);
    } else if (full) {
      await tiles(payload, run, all!);
    } else if (isStageMode(payload.mode) && !prefersReducedMotion()) {
      await stageSwitch(payload, run);
    } else {
      await fadeOut(payload, run);
    }
  } finally {
    onTarget = null;
    current = null;
    fx.getContext('2d')?.clearRect(0, 0, fx.width, fx.height);
    fx.hidden = true;
    glCanvas.hidden = true;
    glCanvas.getAnimations().forEach((a) => a.cancel());
    fx.getAnimations().forEach((a) => a.cancel());
    splash.hidden = true;
    setSite(run.site);
    desk.send(CH.overlayDone);
  }
}

async function glSwitch(payload: TransitionPayload, run: OverlayRun, all: Record<TabId, Mark>): Promise<void> {
  const engine = gl();
  if (!engine || !isGlMode(payload.mode)) return;
  const fromSite = payload.fromSite ?? payload.toSite;
  const from = await take(fromSite, payload.from);
  const execution = payload.mode === 'execution';
  if (execution) await prepareExecution(all);
  const p = dark ? EXECUTION.dark : EXECUTION.light;
  const volume = settings?.executionSound ? (settings.executionVolume ?? 60) / 100 : 0;
  const sound = execution && volume > 0 ? new ExecutionSfx(executionCues(p, payload.toSite), volume) : null;
  const morph = new GlMorph({
    onTick: sound ? (t) => sound.tick(t * p.end) : undefined,
    engine,
    scene: scenes[payload.mode],
    mode: payload.mode,
    w: window.innerWidth,
    h: window.innerHeight,
    dpr: window.devicePixelRatio || 1,
    dark,
    duration: payload.duration,
    from: { site: fromSite, mark: all[fromSite], shot: from },
    to: { site: payload.toSite, mark: all[payload.toSite] },
    origin: payload.origin,
  });
  console.debug(`${payload.mode}: ready in ${morph.prepMs.toFixed(1)} ms`);
  glCanvas.hidden = false;
  run.stop = execution
    ? () => {
        sound?.fade(120);
        const fade = glCanvas.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 180, easing: 'ease-out', fill: 'forwards' });
        void fade.finished.then(
          () => morph.abort(),
          () => morph.abort(),
        );
      }
    : () => morph.abort();
  morph.drawStart();
  await paintSettled();
  splash.hidden = true;
  onTarget = (shot) => morph.setTarget(shot);
  desk.send(CH.overlayCovered);
  if (run.aborted) run.stop();
  const stats = await morph.play();
  if (!stats.aborted) sound?.finish();
}

async function tiles(
  payload: TransitionPayload,
  run: OverlayRun,
  all: Record<TabId, Mark>,
): Promise<void> {
  const fromSite = payload.fromSite ?? payload.toSite;
  const from = await take(fromSite, payload.from);
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
  onTarget = (shot) => morph.setTarget(shot);
  desk.send(CH.overlayCovered);
  if (payload.kind === 'intro') morph.setTarget(await take(payload.toSite, payload.to));
  if (run.aborted) morph.abort();
  await morph.play();
}

async function fadeOut(
  payload: TransitionPayload,
  run: OverlayRun,
): Promise<void> {
  const from = await take(payload.fromSite ?? payload.toSite, payload.from);
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

async function stageSwitch(payload: TransitionPayload, run: OverlayRun): Promise<void> {
  const from = await take(payload.fromSite ?? payload.toSite, payload.from);
  if (run.aborted || !isStageMode(payload.mode)) return;
  const leg: Leg = {
    mode: payload.mode,
    speed: payload.speed,
    fromSite: payload.fromSite ?? payload.toSite,
    toSite: payload.toSite,
    origin: payload.origin,
  };
  const played = stage.play(leg, from, cache.get(payload.toSite) ?? null);
  run.stop = () => stage.stop();
  await paintSettled();
  desk.send(CH.overlayCovered);
  await played;
}

async function fadeSplash(run: OverlayRun): Promise<void> {
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

type BoolKey = 'openAtLogin' | 'closeToTray' | 'hauntPlus' | 'globalShortcut' | 'executionSound';

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

type ChoiceKey = 'startPage' | 'externalLinks' | 'transitionSpeed';

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

const PICK_GROUPS: Array<[StringKey, Array<[AnimationMode, StringKey, StringKey]>]> = [
  [
    'animGroupPlain',
    [
      ['off', 'animOff', 'animOffHint'],
      ['simple', 'animSimple', 'animSimpleHint'],
    ],
  ],
  [
    'animGroupSmooth',
    [
      ['travelling', 'animTravelling', 'animTravellingHint'],
      ['wave', 'animWave', 'animWaveHint'],
      ['portal', 'animPortal', 'animPortalHint'],
    ],
  ],
  [
    'animGroupShow',
    [
      ['prism', 'animPrism', 'animPrismHint'],
      ['full', 'animFull', 'animFullHint'],
      ['fracture', 'animFracture', 'animFractureHint'],
      ['dust', 'animDust', 'animDustHint'],
    ],
  ],
  ['animGroupCinema', [['execution', 'animExecution', 'animExecutionHint']]],
];

let previewGl: GlEngine | null | undefined;
const previewEnv: PreviewEnv = {
  dark: () => dark,
  speed: () => settings?.transitionSpeed ?? 'medium',
  marks: () => marks,
  reduced: prefersReducedMotion,
  gl: () => {
    if (previewGl === undefined) {
      previewGl = GlEngine.create(new OffscreenCanvas(1, 1));
      if (previewGl) warm(previewGl);
    }
    return previewGl?.ok ? previewGl : null;
  },
};

let picks: Array<{ mode: AnimationMode; opt: HTMLElement; preview: Preview }> = [];
let summary: { button: HTMLButtonElement; stage: HTMLElement; name: HTMLElement; desc: HTMLElement; mode: AnimationMode | null; preview: Preview | null } | null = null;

function pickInfo(mode: AnimationMode): [StringKey, StringKey] | null {
  for (const [, options] of PICK_GROUPS) for (const [m, name, hint] of options) if (m === mode) return [name, hint];
  return null;
}

function updateSummary(): void {
  if (!summary || !settings) return;
  const mode = settings.animations;
  const info = pickInfo(mode);
  if (info) {
    summary.name.textContent = tr(info[0]);
    summary.desc.textContent = tr(info[1]);
  }
  if (summary.mode === mode) return;
  summary.preview?.loop(false);
  const preview = new Preview(mode, previewEnv);
  summary.stage.replaceChildren(preview.el);
  summary.preview = preview;
  summary.mode = mode;
}

function transitionPicker(): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'tp-wrap';
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tp-current';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', 'tp-list');
  const stage = document.createElement('span');
  stage.className = 'tp-current-stage';
  const text = document.createElement('span');
  text.className = 'tp-current-text';
  const name = document.createElement('span');
  name.className = 'tp-name';
  const desc = document.createElement('span');
  desc.className = 'tp-desc';
  text.append(name, desc);
  const chevron = document.createElement('span');
  chevron.className = 'tp-chevron';
  chevron.innerHTML = '<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 7.5 10 12.5l5-5"/></svg>';
  button.append(stage, text, chevron);
  summary = { button, stage, name, desc, mode: null, preview: null };
  button.addEventListener('pointerenter', () => summary?.preview?.loop(true));
  button.addEventListener('pointerleave', () => summary?.preview?.loop(false));

  const group = document.createElement('div');
  group.className = 'tp';
  group.id = 'tp-list';
  group.hidden = true;
  const setOpen = (open: boolean) => {
    group.hidden = !open;
    button.setAttribute('aria-expanded', String(open));
    button.title = tr(open ? 'animCollapse' : 'animExpand');
    if (open) group.scrollIntoView({ block: 'nearest', behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
  };
  setOpen(false);
  button.addEventListener('click', () => setOpen(group.hidden));
  wrap.append(button, group);
  group.setAttribute('role', 'radiogroup');
  group.setAttribute('aria-label', tr('tabTransition'));
  picks = [];
  PICK_GROUPS.forEach(([label, options], g) => {
    const set = document.createElement('div');
    set.className = 'tp-group';
    set.setAttribute('role', 'group');
    const title = document.createElement('span');
    title.className = 'tp-group-title';
    title.id = `tp-group-${g}`;
    title.textContent = tr(label);
    set.setAttribute('aria-labelledby', title.id);
    set.append(title);
    group.append(set);
    for (const [mode, name, hint] of options) picks.push(pickOption(set, mode, name, hint));
    if (label === 'animGroupCinema') set.append(executionSound());
  });
  group.addEventListener('keydown', (event) => {
    const at = picks.findIndex((p) => p.opt === document.activeElement);
    if (at < 0) return;
    const last = picks.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: at === last ? 0 : at + 1,
      ArrowDown: at === last ? 0 : at + 1,
      ArrowLeft: at === 0 ? last : at - 1,
      ArrowUp: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
      ' ': at,
      Enter: at,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    picks[next].opt.focus();
    pickTransition(picks[next].mode);
  });
  updateSummary();
  return wrap;
}

function pickOption(set: HTMLElement, mode: AnimationMode, name: StringKey, hint: StringKey): (typeof picks)[number] {
  const preview = new Preview(mode, previewEnv);
  const opt = document.createElement('div');
  opt.className = 'tp-opt';
  opt.setAttribute('role', 'radio');
  opt.dataset.value = mode;
  const title = document.createElement('span');
  title.className = 'tp-name';
  title.textContent = tr(name);
  opt.title = tr(hint);
  opt.append(preview.el, title);
  opt.addEventListener('pointerenter', () => preview.loop(true));
  opt.addEventListener('pointerleave', () => preview.loop(document.activeElement === opt));
  opt.addEventListener('focus', () => preview.loop(true));
  opt.addEventListener('blur', () => preview.loop(opt.matches(':hover')));
  opt.addEventListener('click', () => pickTransition(mode));
  set.append(opt);
  return { mode, opt, preview };
}

function executionSound(): HTMLElement {
  const box = document.createElement('div');
  box.className = 'tp-extra';
  const row = document.createElement('label');
  row.className = 'sp-row tp-volume';
  const name = document.createElement('span');
  name.className = 'sp-label';
  name.textContent = tr('executionVolume');
  const out = document.createElement('output');
  out.id = 'execution-volume-at';
  const input = document.createElement('input');
  input.type = 'range';
  input.id = 'execution-volume';
  input.min = '0';
  input.max = '100';
  input.step = '5';
  input.addEventListener('input', () => {
    out.textContent = `${input.value} %`;
    change({ executionVolume: Number(input.value) });
  });
  row.append(name, out, input);
  box.append(toggleRow('executionSound', 'executionSound'), row);
  return box;
}

function pickTransition(mode: AnimationMode): void {
  if (settings?.animations !== mode) change({ animations: mode });
  syncPicker();
  picks.find((p) => p.mode === mode)?.preview.play();
}

function syncPicker(): void {
  for (const { mode, opt } of picks) {
    const on = settings?.animations === mode;
    opt.setAttribute('aria-checked', String(on));
    opt.tabIndex = on ? 0 : -1;
  }
  updateSummary();
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
      textBlock('tabTransition'),
      transitionPicker(),
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
  syncPicker();
  const volume = document.getElementById('execution-volume') as HTMLInputElement | null;
  if (volume && document.activeElement !== volume) volume.value = String(settings.executionVolume);
  const volumeAt = document.getElementById('execution-volume-at');
  if (volumeAt) volumeAt.textContent = `${settings.executionVolume} %`;
  if (volume) volume.disabled = !settings.executionSound;
  const speed = panel.querySelector<HTMLElement>('.seg[data-key="transitionSpeed"]');
  if (speed) {
    const off = settings.animations === 'simple' || settings.animations === 'off';
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
  desk.on<TransitionPlayPayload>(CH.transitionPlay, async (data) => {
    const wanted = onTarget;
    const fresh = await take(data.tab, data.to);
    if (stage.refresh(data.tab, fresh)) return;
    if (wanted && onTarget === wanted) wanted((fresh?.bitmap ? fresh : cache.get(data.tab)) ?? null);
  });
  desk.on<TransitionChainPayload>(CH.transitionChain, (leg) => {
    if (current && stage.chain(leg, cache.get(leg.toSite) ?? null)) current.site = leg.toSite;
    void paintSettled().then(() => desk.send(CH.overlayCovered));
  });
  desk.on<TransitionPlayPayload>(CH.shotCache, (data) => void take(data.tab, data.to));
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
    prepareGl();
  });
  prepareGl();
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
    for (const pick of picks) pick.preview.repaint();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && settingsOpen) void closeSettings(true);
    else if (event.key === 'Escape' && noticeOpen && !noticeGo) closeNotice();
  });

  if (!document.hidden) await paintSettled();
  desk.send(CH.overlayReady);
}

void main();
