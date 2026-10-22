import { CH } from '../shared/channels';
import type { PopupAction, PopupState, SiteId, UiInit } from '../shared/types';
import { applyFont, applyPalette, desk, hostOf, ICONS, iconButton, LOGOS, setLocale, siteName, tr } from './common';

const brand = document.getElementById('brand') as HTMLImageElement;
const nav = document.getElementById('nav')!;
const tail = document.getElementById('tail')!;
const lock = document.getElementById('lock')!;
const host = document.getElementById('host')!;
const pageTitle = document.getElementById('page-title')!;
const progress = document.getElementById('progress')!;

let source: SiteId = 'haunt';
let copyTimer = 0;

function act(action: PopupAction): void {
  desk.send(CH.popupAction, action);
}

function build(): void {
  const back = iconButton('back', 'back', tr('back'));
  const forward = iconButton('forward', 'forward', tr('forward'));
  const reload = iconButton('reload', 'reload', tr('reload'));
  back.addEventListener('click', () => act('back'));
  forward.addEventListener('click', () => act('forward'));
  reload.addEventListener('click', () => act('reload'));
  nav.append(back, forward, reload);

  const copy = document.createElement('button');
  copy.type = 'button';
  copy.id = 'copy';
  copy.className = 'icon-btn copy';
  copy.title = tr('copyLink');
  copy.setAttribute('aria-label', tr('copyLink'));
  copy.innerHTML = `<span class="ico ico-link">${ICONS.link}</span><span class="ico ico-check">${ICONS.check}</span>`;
  copy.addEventListener('click', () => act('copy'));

  const browser = iconButton('browser', 'external', tr('openInBrowser'));
  browser.addEventListener('click', () => act('browser'));
  tail.append(copy, browser);

  brand.src = LOGOS[source];
  brand.title = siteName(source);
}

function render(state: PopupState): void {
  const secure = state.url.startsWith('https:');
  lock.innerHTML = secure ? ICONS.lock : ICONS.unlock;
  lock.dataset.secure = secure ? '1' : '0';
  lock.title = tr(secure ? 'secure' : 'notSecure');
  host.textContent = hostOf(state.url);
  pageTitle.textContent = state.title && state.title !== state.url ? state.title : '';
  (document.getElementById('back') as HTMLButtonElement).disabled = !state.canGoBack;
  (document.getElementById('forward') as HTMLButtonElement).disabled = !state.canGoForward;
  progress.dataset.on = state.loading ? '1' : '0';
}

function flashCopied(): void {
  const copy = document.getElementById('copy')!;
  copy.dataset.done = '1';
  window.clearTimeout(copyTimer);
  copyTimer = window.setTimeout(() => (copy.dataset.done = '0'), 1400);
}

async function main(): Promise<void> {
  const init = await desk.invoke<UiInit>(CH.init);
  setLocale(init.locale);
  applyFont(init.settings.font);
  source = init.site === 'tools' ? 'tools' : 'haunt';
  applyPalette(source, init.dark);
  build();

  desk.on<PopupState>(CH.popupState, render);
  desk.on(CH.linkCopied, flashCopied);
  desk.on<{ dark: boolean }>(CH.theme, (theme) => applyPalette(source, theme.dark));
}

void main();
