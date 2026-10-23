import type { Clip, Project, Track } from '../../shared/types';
import { clipEnd, clipLength, duration, MIN_CLIP, mediaOf, typeOf } from './project';

export interface TimelineHost {
  project(): Project;
  selected(): string | null;
  select(id: string | null): void;
  time(): number;
  seek(t: number): void;
  changed(commit: boolean): void;
  dropMedia(mediaId: string, track: Track | null, t: number): void;
  label(kind: Track['kind'], n: number): string;
  clipLabel(clip: Clip): string;
  muteLabel: string;
}

type Drag =
  | { mode: 'move'; clip: Clip; from: Track; orig: Clip; x: number; moved: boolean }
  | { mode: 'trim-left' | 'trim-right'; clip: Clip; orig: Clip; x: number }
  | { mode: 'scrub' };

const SNAP_PX = 8;
const HEIGHT = { video: 56, audio: 44 };

export class Timeline {
  private pps = 0;
  private drag: Drag | null = null;
  private readonly labels: HTMLElement;
  private readonly scroll: HTMLElement;
  private readonly inner: HTMLElement;
  private readonly ruler: HTMLCanvasElement;
  private readonly rows: HTMLElement;
  private readonly playhead: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly host: TimelineHost,
  ) {
    root.classList.add('tl');
    this.labels = el('div', 'tl-labels');
    this.scroll = el('div', 'tl-scroll');
    this.inner = el('div', 'tl-inner');
    this.ruler = el('canvas', 'tl-ruler');
    this.rows = el('div', 'tl-rows');
    this.playhead = el('div', 'tl-playhead');
    this.inner.append(this.ruler, this.rows, this.playhead);
    this.scroll.append(this.inner);
    root.append(this.labels, this.scroll);

    this.ruler.addEventListener('pointerdown', (e) => {
      this.ruler.setPointerCapture(e.pointerId);
      this.drag = { mode: 'scrub' };
      this.host.seek(this.timeAt(e.clientX));
    });
    this.ruler.addEventListener('pointermove', (e) => {
      if (this.drag?.mode === 'scrub') this.host.seek(this.timeAt(e.clientX));
    });
    this.ruler.addEventListener('pointerup', () => (this.drag = null));
    this.rows.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.clip')) return;
      this.host.select(null);
      this.host.seek(this.timeAt(e.clientX));
    });
    this.scroll.addEventListener(
      'wheel',
      (e) => {
        if (!e.ctrlKey) return;
        e.preventDefault();
        const x = e.clientX - this.scroll.getBoundingClientRect().left + this.scroll.scrollLeft;
        const t = x / this.pps;
        this.zoom(Math.exp(-e.deltaY * 0.002));
        this.scroll.scrollLeft = t * this.pps - (e.clientX - this.scroll.getBoundingClientRect().left);
      },
      { passive: false },
    );
    this.scroll.addEventListener('scroll', () => {
      this.labels.scrollTop = this.scroll.scrollTop;
    });
    new ResizeObserver(() => this.render()).observe(this.scroll);
  }

  zoom(factor: number): void {
    this.pps = Math.min(400, Math.max(2, this.pps * factor));
    this.render();
  }

  fit(): void {
    this.pps = 0;
    this.render();
  }

  private timeAt(clientX: number): number {
    const x = clientX - this.scroll.getBoundingClientRect().left + this.scroll.scrollLeft;
    return Math.max(0, x / this.pps);
  }

  private displayOrder(p: Project): Track[] {
    return [...p.tracks.filter((t) => t.kind === 'video').reverse(), ...p.tracks.filter((t) => t.kind === 'audio')];
  }

  render(): void {
    const p = this.host.project();
    const total = duration(p);
    const view = Math.max(200, this.scroll.clientWidth);
    if (!this.pps) this.pps = Math.max(2, (view - 40) / Math.max(10, total));
    const width = Math.max(view, (total + 10) * this.pps);
    this.inner.style.width = `${width}px`;

    this.labels.replaceChildren(el('div', 'tl-corner'));
    this.rows.replaceChildren();
    const counts = { video: 0, audio: 0 };
    const order = this.displayOrder(p);
    const numbers = new Map<Track, number>();
    for (const t of p.tracks) numbers.set(t, ++counts[t.kind]);
    for (const track of order) {
      const label = el('div', `tl-label ${track.kind}`);
      label.style.height = `${HEIGHT[track.kind]}px`;
      const name = el('span', '');
      name.textContent = this.host.label(track.kind, numbers.get(track)!);
      const mute = el('button', `tl-mute${track.muted ? ' on' : ''}`);
      mute.type = 'button';
      mute.title = this.host.muteLabel;
      mute.setAttribute('aria-label', this.host.muteLabel);
      mute.setAttribute('aria-pressed', String(track.muted));
      mute.innerHTML = track.muted
        ? '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path stroke="currentColor" stroke-width="2" stroke-linecap="round" d="m16 9 5 6m0-6-5 6"/></svg>'
        : '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path fill="currentColor" d="M4 9h4l5-4v14l-5-4H4z"/><path fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" d="M16 9a4 4 0 0 1 0 6m2.5-8.5a7.5 7.5 0 0 1 0 11"/></svg>';
      mute.addEventListener('click', () => {
        track.muted = !track.muted;
        this.host.changed(true);
      });
      label.append(name, mute);
      this.labels.append(label);

      const row = el('div', `tl-row ${track.kind}`);
      row.style.height = `${HEIGHT[track.kind]}px`;
      row.dataset.track = track.id;
      row.addEventListener('dragover', (e) => {
        if (e.dataTransfer?.types.includes('text/x-media')) {
          e.preventDefault();
          row.classList.add('drop');
        }
      });
      row.addEventListener('dragleave', () => row.classList.remove('drop'));
      row.addEventListener('drop', (e) => {
        row.classList.remove('drop');
        const id = e.dataTransfer?.getData('text/x-media');
        if (!id) return;
        e.preventDefault();
        this.host.dropMedia(id, track, this.timeAt(e.clientX));
      });
      for (const clip of track.clips) row.append(this.clipElement(p, track, clip));
      this.rows.append(row);
    }
    this.drawRuler(width);
    this.setTime(this.host.time());
  }

  private clipElement(p: Project, track: Track, clip: Clip): HTMLElement {
    const media = mediaOf(p, clip);
    const type = typeOf(clip);
    const kind = type !== 'media' ? ` ${type}` : media?.kind === 'image' ? ' image' : '';
    const box = el('div', `clip ${track.kind}${kind}${this.host.selected() === clip.id ? ' selected' : ''}`);
    box.style.left = `${clip.start * this.pps}px`;
    box.style.width = `${Math.max(4, clipLength(clip) * this.pps)}px`;
    box.dataset.clip = clip.id;
    const name = el('span', 'clip-name');
    name.textContent = this.host.clipLabel(clip);
    box.append(name);
    const seen = new Set<number>();
    for (const keys of Object.values(clip.keyframes ?? {})) {
      for (const k of keys ?? []) {
        const x = Math.round(k.t * this.pps);
        if (seen.has(x)) continue;
        seen.add(x);
        const dot = el('span', 'clip-key');
        dot.style.left = `${x}px`;
        box.append(dot);
      }
    }
    for (const z of clip.zooms ?? []) {
      const bar = el('span', 'clip-zoom');
      bar.style.left = `${z.t * this.pps}px`;
      bar.style.width = `${Math.max(2, z.d * this.pps)}px`;
      box.append(bar);
    }
    if (clip.speed !== 1) {
      const badge = el('span', 'clip-badge');
      badge.textContent = `${clip.speed}×`;
      box.append(badge);
    }
    box.append(el('span', 'clip-edge left'), el('span', 'clip-edge right'));
    box.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      box.setPointerCapture(e.pointerId);
      this.host.select(clip.id);
      const edge = (e.target as HTMLElement).classList;
      const orig = { ...clip };
      if (edge.contains('left')) this.drag = { mode: 'trim-left', clip, orig, x: e.clientX };
      else if (edge.contains('right')) this.drag = { mode: 'trim-right', clip, orig, x: e.clientX };
      else this.drag = { mode: 'move', clip, from: track, orig, x: e.clientX, moved: false };
    });
    box.addEventListener('pointermove', (e) => this.onDrag(e, box));
    box.addEventListener('pointerup', (e) => this.endDrag(e));
    box.addEventListener('dblclick', () => this.host.seek(clip.start));
    return box;
  }

  private snapPoints(except: Clip): number[] {
    const points = [0, this.host.time()];
    for (const t of this.host.project().tracks) {
      for (const c of t.clips) {
        if (c.id === except.id) continue;
        points.push(c.start, clipEnd(c));
      }
    }
    return points;
  }

  private snap(value: number, points: number[]): number | null {
    let best: number | null = null;
    for (const p of points) {
      if (Math.abs(p - value) * this.pps <= SNAP_PX && (best === null || Math.abs(p - value) < Math.abs(best - value))) best = p;
    }
    return best;
  }

  private onDrag(e: PointerEvent, box: HTMLElement): void {
    const d = this.drag;
    if (!d || d.mode === 'scrub') return;
    const p = this.host.project();
    const dt = (e.clientX - d.x) / this.pps;
    const media = mediaOf(p, d.clip);
    const points = this.snapPoints(d.clip);
    const o = d.orig;
    if (d.mode === 'move') {
      if (Math.abs(e.clientX - d.x) > 2) d.moved = true;
      let start = Math.max(0, o.start + dt);
      const len = clipLength(o);
      const s1 = this.snap(start, points);
      const s2 = this.snap(start + len, points);
      if (s1 !== null) start = s1;
      else if (s2 !== null) start = s2 - len;
      d.clip.start = Math.max(0, start);
      const row = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest<HTMLElement>('.tl-row');
      const target = row && p.tracks.find((t) => t.id === row.dataset.track);
      const current = p.tracks.find((t) => t.clips.includes(d.clip))!;
      if (row && target && target !== current && target.kind === current.kind) {
        current.clips = current.clips.filter((c) => c !== d.clip);
        target.clips.push(d.clip);
        row.append(box);
      }
    } else if (d.mode === 'trim-left') {
      const end = clipEnd(o);
      let start = o.start + dt;
      const snapped = this.snap(start, points);
      if (snapped !== null) start = snapped;
      const free = !media || media.kind === 'image';
      const earliest = free ? 0 : o.start - o.in / o.speed;
      start = Math.min(end - MIN_CLIP, Math.max(Math.max(0, earliest), start));
      d.clip.start = start;
      if (free) d.clip.out = o.out + (o.start - start) * o.speed;
      else d.clip.in = o.in + (start - o.start) * o.speed;
    } else {
      let end = clipEnd(o) + dt;
      const snapped = this.snap(end, points);
      if (snapped !== null) end = snapped;
      const latest = media && media.kind !== 'image' ? o.start + (media.duration - o.in) / o.speed : Infinity;
      end = Math.max(o.start + MIN_CLIP, Math.min(latest, end));
      d.clip.out = o.in + (end - o.start) * o.speed;
    }
    box.style.left = `${d.clip.start * this.pps}px`;
    box.style.width = `${Math.max(4, clipLength(d.clip) * this.pps)}px`;
    this.host.changed(false);
  }

  private endDrag(e: PointerEvent): void {
    const d = this.drag;
    this.drag = null;
    if (!d || d.mode === 'scrub') return;
    (e.target as HTMLElement).releasePointerCapture?.(e.pointerId);
    const p = this.host.project();
    const track = p.tracks.find((t) => t.clips.includes(d.clip));
    const overlaps = track?.clips.some((c) => c !== d.clip && c.start < clipEnd(d.clip) - 1e-6 && clipEnd(c) > d.clip.start + 1e-6);
    if (overlaps && track) {
      Object.assign(d.clip, d.orig);
      if (d.mode === 'move' && track !== d.from) {
        track.clips = track.clips.filter((c) => c !== d.clip);
        d.from.clips.push(d.clip);
      }
      this.host.changed(false);
      this.render();
      return;
    }
    if (d.mode === 'move' && !d.moved) return;
    this.host.changed(true);
  }

  setTime(t: number): void {
    const x = t * this.pps;
    this.playhead.style.transform = `translateX(${x}px)`;
    const left = this.scroll.scrollLeft;
    const w = this.scroll.clientWidth;
    if (!this.drag && (x < left || x > left + w - 20)) this.scroll.scrollLeft = Math.max(0, x - w * 0.2);
  }

  private drawRuler(width: number): void {
    const dpr = window.devicePixelRatio || 1;
    const h = 24;
    this.ruler.width = Math.round(width * dpr);
    this.ruler.height = Math.round(h * dpr);
    this.ruler.style.width = `${width}px`;
    const ctx = this.ruler.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const styles = getComputedStyle(this.ruler);
    ctx.fillStyle = styles.color;
    ctx.strokeStyle = styles.borderBottomColor || styles.color;
    ctx.font = `11px ${getComputedStyle(document.body).fontFamily}`;
    ctx.textBaseline = 'top';
    const steps = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
    const step = steps.find((s) => s * this.pps >= 70) ?? 600;
    const minor = step / 5;
    ctx.beginPath();
    for (let i = 0; i * minor * this.pps <= width; i++) {
      const t = Math.round(i * minor * 1000) / 1000;
      const x = Math.round(t * this.pps) + 0.5;
      const major = i % 5 === 0;
      ctx.moveTo(x, major ? 12 : 18);
      ctx.lineTo(x, h);
      if (major) ctx.fillText(timecode(t, step < 1), x + 4, 2);
    }
    ctx.globalAlpha = 0.5;
    ctx.stroke();
  }
}

export function timecode(t: number, fine = false): string {
  const s = Math.max(0, t);
  const m = Math.floor(s / 60);
  const sec = s - m * 60;
  const tenths = Math.floor(sec * 10 + 1e-6);
  const base = `${m}:${String(Math.floor(tenths / 10)).padStart(2, '0')}`;
  return fine ? `${base}.${tenths % 10}` : base;
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}
