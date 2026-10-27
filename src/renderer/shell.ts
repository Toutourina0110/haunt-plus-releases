import { CH } from '../shared/channels';
import { TABS, type AnimationMode, type FindResult, type Settings, type ShellState, type TabId, type UiInit } from '../shared/types';
import { keyLabel } from '../shared/shortcuts';
import { applyFont, applyPalette, desk, ICONS, iconButton, setLocale, siteName, tr } from './common';
import { pillTokens } from './motion/tokens';

const switchEl = document.getElementById('switch')!;
const navEl = document.getElementById('nav')!;
const tailEl = document.getElementById('tail')!;
const titleEl = document.getElementById('title')!;
const titleWrap = document.getElementById('title-wrap')!;
const progressEl = document.getElementById('progress')!;
const siteButtons = [...switchEl.querySelectorAll<HTMLButtonElement>('.switch-btn')];

let dark = true;
let active: TabId = 'haunt';
let copyTimer = 0;
let url = '';
let stopEdit: (() => void) | null = null;
let stopFind: (() => void) | null = null;
let findInput: HTMLInputElement | null = null;
let findCount: HTMLElement | null = null;

const PREFIX: Partial<Record<TabId, string>> = { haunt: 'https://haunt.gg/', tools: 'https://haunt-tools.site/' };

function pathOf(raw: string): string {
  try {
    const u = new URL(raw);
    return (u.pathname + u.search + u.hash).replace(/^\//, '');
  } catch {
    return '';
  }
}

function startEdit(): void {
  const prefix = PREFIX[active];
  if (!prefix || stopEdit) return;
  const form = document.createElement('form');
  form.className = 'address';
  const lead = document.createElement('span');
  lead.className = 'address-lead';
  lead.textContent = prefix;
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.value = pathOf(url);
  input.setAttribute('aria-label', tr('address'));
  form.append(lead, input);
  titleWrap.classList.add('editing');
  titleWrap.append(form);
  stopEdit = () => {
    stopEdit = null;
    form.remove();
    titleWrap.classList.remove('editing');
  };
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    desk.send(CH.navTo, input.value.trim());
    stopEdit?.();
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stopEdit?.();
  });
  input.addEventListener('blur', () => stopEdit?.());
  input.focus();
  input.select();
}

function findButton(label: string, svg: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'find-btn';
  b.title = label;
  b.setAttribute('aria-label', label);
  b.innerHTML = svg;
  b.addEventListener('mousedown', (event) => event.preventDefault());
  b.addEventListener('click', onClick);
  return b;
}

function startFind(): void {
  if (findInput) {
    findInput.focus();
    findInput.select();
    return;
  }
  stopEdit?.();
  const form = document.createElement('form');
  form.className = 'address find';
  const input = document.createElement('input');
  input.type = 'text';
  input.spellcheck = false;
  input.placeholder = tr('findPlaceholder');
  input.setAttribute('aria-label', tr('findPlaceholder'));
  const count = document.createElement('span');
  count.className = 'find-count';
  count.setAttribute('role', 'status');
  const go = (forward: boolean, first: boolean) => desk.send(CH.findQuery, { text: input.value, forward, first });
  const chevron = (d: string) => `<svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
  form.append(
    input,
    count,
    findButton(`${tr('findPrev')} (${keyLabel('Shift', document.documentElement.lang)}+Enter)`, chevron('M5 12.5 10 7.5l5 5'), () => go(false, false)),
    findButton(`${tr('findNext')} (Enter)`, chevron('M5 7.5 10 12.5l5-5'), () => go(true, false)),
    findButton(`${tr('findClose')} (Esc)`, ICONS.close, () => stopFind?.()),
  );
  titleWrap.classList.add('editing', 'finding');
  titleWrap.append(form);
  findInput = input;
  findCount = count;
  stopFind = () => {
    stopFind = null;
    findInput = null;
    findCount = null;
    form.remove();
    titleWrap.classList.remove('editing', 'finding');
    desk.send(CH.findStop);
  };
  form.addEventListener('submit', (event) => event.preventDefault());
  input.addEventListener('input', () => go(true, true));
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') stopFind?.();
    else if (event.key === 'Enter') {
      event.preventDefault();
      go(!event.shiftKey, false);
    }
  });
  input.focus();
}

function showFindResult(result: FindResult): void {
  if (!findCount || !findInput) return;
  findCount.textContent = findInput.value ? (result.matches ? `${result.active}/${result.matches}` : tr('findNone')) : '';
  findCount.classList.toggle('none', !!findInput.value && !result.matches);
}

function build(): void {
  const back = iconButton('back', 'back', tr('back'));
  const forward = iconButton('forward', 'forward', tr('forward'));
  const reload = iconButton('reload', 'reload', tr('reload'));
  const home = iconButton('home', 'home', `${tr('homePage')} (Alt+${keyLabel('Home', document.documentElement.lang)})`);
  back.addEventListener('click', () => desk.send(CH.nav, 'back'));
  forward.addEventListener('click', () => desk.send(CH.nav, 'forward'));
  reload.addEventListener('click', () => desk.send(CH.nav, 'reload'));
  home.addEventListener('click', () => desk.send(CH.nav, 'home'));
  navEl.append(back, forward, reload, home);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.id = 'copy';
  copy.className = 'icon-btn copy';
  copy.title = tr('copyLink');
  copy.setAttribute('aria-label', tr('copyLink'));
  copy.innerHTML = `<span class="ico ico-link">${ICONS.link}</span><span class="ico ico-check">${ICONS.check}</span>`;
  copy.addEventListener('click', () => desk.send(CH.copyLink));
  const help = iconButton('help', 'help', tr('tourApp'));
  help.addEventListener('click', () => desk.send(CH.tourRequest));
  const settings = iconButton('settings', 'gear', `${tr('settings')} (${keyLabel('Control', document.documentElement.lang)}+S)`);
  settings.addEventListener('click', () => desk.send(CH.settingsRequest));
  tailEl.append(help, settings, copy);
  const pencil = document.createElement('span');
  pencil.className = 'title-edit';
  pencil.innerHTML = ICONS.edit;
  titleWrap.append(pencil);
  titleWrap.title = `${tr('address')} (${keyLabel('Control', document.documentElement.lang)}+L)`;
  titleWrap.addEventListener('click', () => {
    if (!stopFind) startEdit();
  });

  switchEl.setAttribute('aria-label', 'haunt+');
  for (const button of siteButtons) {
    const site = button.dataset.site as TabId;
    const label = siteName(site);
    button.title = `${label}  (${keyLabel('Control', document.documentElement.lang)}+${TABS.indexOf(site) + 1})`;
    button.setAttribute('aria-label', label);
    if (site === 'images') button.addEventListener('pointerenter', () => desk.send(CH.warmTab, site), { once: true });
    button.addEventListener('click', () => {
      if (site === active) return;
      setActive(site);
      desk.send(CH.switchSite, site);
    });
  }
  switchEl.addEventListener('keydown', (event) => {
    const at = siteButtons.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const last = siteButtons.length - 1;
    const moves: Record<string, number> = {
      ArrowRight: at === last ? 0 : at + 1,
      ArrowLeft: at === 0 ? last : at - 1,
      Home: 0,
      End: last,
    };
    const next = moves[event.key];
    if (next === undefined) return;
    event.preventDefault();
    siteButtons[next].focus();
  });
}

function applyPill(mode: AnimationMode): void {
  switchEl.style.setProperty('--pill-ms', `${pillTokens[mode].ms}ms`);
  switchEl.style.setProperty('--pill-ease', pillTokens[mode].ease);
}

function setActive(site: TabId): void {
  active = site;
  switchEl.style.setProperty('--index', String(TABS.indexOf(site)));
  for (const button of siteButtons) {
    const on = button.dataset.site === site;
    button.setAttribute('aria-selected', String(on));
    button.tabIndex = on ? 0 : -1;
  }
  applyPalette(site, dark);
}

function render(state: ShellState): void {
  if (state.active !== active) {
    stopEdit?.();
    stopFind?.();
    setActive(state.active);
  }
  url = state.url;
  titleWrap.classList.toggle('editable', !!PREFIX[state.active]);
  titleEl.textContent = state.title || siteName(state.active);
  (document.getElementById('back') as HTMLButtonElement).disabled = !state.canGoBack;
  (document.getElementById('forward') as HTMLButtonElement).disabled = !state.canGoForward;
  progressEl.dataset.on = state.loading ? '1' : '0';
}

function flashCopied(): void {
  const copy = document.getElementById('copy')!;
  copy.dataset.done = '1';
  copy.title = tr('linkCopied');
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => {
    copy.dataset.done = '0';
    copy.title = tr('copyLink');
  }, 1400);
}

async function main(): Promise<void> {
  const init = await desk.invoke<UiInit>(CH.init);
  setLocale(init.locale);
  applyFont(init.settings.font);
  dark = init.dark;
  build();
  setActive(init.site);
  applyPill(init.settings.animations);
  desk.on<Settings>(CH.settingsChanged, (next) => applyPill(next.animations));
  titleEl.textContent = siteName(init.site);

  desk.on<ShellState>(CH.state, render);
  desk.on(CH.linkCopied, flashCopied);
  desk.on(CH.addressEdit, () => {
    stopFind?.();
    startEdit();
  });
  desk.on(CH.findOpen, startFind);
  desk.on<FindResult>(CH.findResult, showFindResult);
  desk.on<{ dark: boolean }>(CH.theme, (theme) => {
    dark = theme.dark;
    applyPalette(active, dark);
  });
}

void main();
