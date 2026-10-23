import { CH } from '../shared/channels';
import type { RecBarInit, RecBarState } from '../shared/types';
import { applyFont, desk, setLocale, tr } from './common';

const bar = document.querySelector('.recbar') as HTMLElement;
const time = document.getElementById('time') as HTMLElement;
const pause = document.getElementById('pause') as HTMLButtonElement;
const stop = document.getElementById('stop') as HTMLButtonElement;
const cancel = document.getElementById('cancel') as HTMLButtonElement;

const svg = (body: string) =>
  `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${body}</svg>`;
const PAUSE = svg('<path fill="currentColor" d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z"/>');
const PLAY = svg('<path fill="currentColor" d="M8 5v14l11-7z"/>');
const STOP = svg('<rect x="6" y="6" width="12" height="12" rx="2.5" fill="currentColor"/>');
const CLOSE = svg('<path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M6 6l12 12M18 6 6 18"/>');

let paused = false;

function label(b: HTMLButtonElement, text: string, icon: string): void {
  b.title = text;
  b.setAttribute('aria-label', text);
  b.innerHTML = icon;
}

function clock(seconds: number): string {
  const s = Math.floor(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

function show(state: RecBarState): void {
  paused = state.paused;
  bar.classList.toggle('paused', paused);
  time.textContent = clock(state.elapsed);
  label(pause, tr(paused ? 'recResume' : 'recPause'), paused ? PLAY : PAUSE);
}

pause.addEventListener('click', () => desk.send(CH.recbarAction, paused ? 'resume' : 'pause'));
stop.addEventListener('click', () => desk.send(CH.recbarAction, 'stop'));
cancel.addEventListener('click', () => desk.send(CH.recbarAction, 'cancel'));

async function main(): Promise<void> {
  const init = await desk.invoke<RecBarInit>(CH.recbarInit);
  setLocale(init.locale);
  void applyFont(init.font);
  label(stop, tr('recStop'), STOP);
  label(cancel, tr('capCancel'), CLOSE);
  show({ paused: false, elapsed: 0 });
  desk.on<RecBarState>(CH.recbarState, show);
}

void main();
