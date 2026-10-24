import { CH } from '../shared/channels';
import { TABS, type ShellState, type TabId, type UiInit } from '../shared/types';
import { keyLabel } from '../shared/shortcuts';
import { applyFont, applyPalette, desk, ICONS, iconButton, setLocale, siteName, tr } from './common';

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
  titleWrap.addEventListener('click', startEdit);

  switchEl.setAttribute('aria-label', 'haunt+');
  for (const button of siteButtons) {
    const site = button.dataset.site as TabId;
    const label = siteName(site);
    button.title = `${label}  (${keyLabel('Control', document.documentElement.lang)}+${TABS.indexOf(site) + 1})`;
    button.setAttribute('aria-label', label);
    button.addEventListener('click', () => {
      if (site === active) return;
      setActive(site);
      desk.send(CH.switchSite, site);
    });
  }
}

function setActive(site: TabId): void {
  active = site;
  switchEl.style.setProperty('--index', String(TABS.indexOf(site)));
  for (const button of siteButtons) {
    button.setAttribute('aria-selected', String(button.dataset.site === site));
  }
  applyPalette(site, dark);
}

function render(state: ShellState): void {
  if (state.active !== active) {
    stopEdit?.();
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
  titleEl.textContent = siteName(init.site);

  desk.on<ShellState>(CH.state, render);
  desk.on(CH.linkCopied, flashCopied);
  desk.on(CH.addressEdit, startEdit);
  desk.on<{ dark: boolean }>(CH.theme, (theme) => {
    dark = theme.dark;
    applyPalette(active, dark);
  });
}

void main();
