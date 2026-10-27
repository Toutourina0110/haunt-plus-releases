import type { TabId } from '../../shared/types';
import { EXECUTION, INK_BLACK, PAPER, STAMP_RED, type ExecutionParams } from './execution-params';
import { Brush, line } from './gl/brush';
import { KIND, type Rgb } from './gl/engine';
import { INK, Ink } from './gl/ink';
import { loadLettering, title, stamp } from './gl/lettering';
import { inOut3, mixRgb, rgbOf, smooth, span } from './gl/math';
import type { SceneMaker } from './gl/morph';
import { MARK_MAP, type Mark } from '../tiles';

type P = [number, number];

export const EXECUTION_NAMES: Record<TabId, string> = { haunt: 'HAUNT', tools: 'HAUNT TOOLS', images: 'IMAGEHOST' };

export interface Cue {
  at: number;
  sound: 'whoosh' | 'tension' | 'tac' | 'stamp' | 'fsht' | 'impact' | 'breath' | 'click' | 'collapse' | 'chord' | 'final';
  length?: number;
}

export function executionCues(p: ExecutionParams, tab: TabId): Cue[] {
  const cues: Cue[] = [{ at: 0, sound: 'whoosh' }, { at: p.shot2, sound: 'tension', length: p.shot4 + 0.55 - p.shot2 }];
  const name = EXECUTION_NAMES[tab];
  [...name].forEach((c, i) => {
    if (c.trim()) cues.push({ at: p.shot3 + i * p.letterGap, sound: 'tac' });
  });
  cues.push({ at: stampAt(p, name), sound: 'stamp' });
  for (const s of [p.strike1, p.strike2, p.strike3]) cues.push({ at: s, sound: 'fsht' }, { at: s + p.cross, sound: 'impact' });
  cues.push(
    { at: p.shot6, sound: 'breath', length: p.sheathe - p.shot6 },
    { at: p.sheathe, sound: 'click' },
    { at: p.shot7, sound: 'collapse' },
    { at: p.shot7 + 0.35, sound: 'chord' },
    { at: p.shot8 + p.backToReal, sound: 'final' },
  );
  return cues;
}

export function executionFlashes(p: ExecutionParams): number[] {
  return [p.strike1, p.strike2, p.strike3].map((s) => s + p.cross);
}

export async function prepareExecution(marks: Record<TabId, Mark>): Promise<void> {
  await loadLettering();
  for (const tab of Object.keys(EXECUTION_NAMES) as TabId[]) {
    const [r, g, b] = marks[tab].rgb;
    title(EXECUTION_NAMES[tab], css([r / 255, g / 255, b / 255]), INK_BLACK, PAPER);
  }
  stamp(STAMP_RED, PAPER);
}

const stampAt = (p: ExecutionParams, name: string) => p.shot3 + name.length * p.letterGap + p.letterDrop + 0.05;
const expoOut = (u: number) => (u >= 1 ? 1 : 1 - 2 ** (-10 * u));
const in2 = (u: number) => u * u;
const out2 = (u: number) => 1 - (1 - u) * (1 - u);

interface Piece {
  poly: P[];
  cx: number;
  cy: number;
  sides: number[];
  delay: number;
  spin: number;
  slide: P;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  born: number;
  life: number;
  size: number;
  col: Rgb;
  frozen: boolean;
  fall: number;
}

export const execution: SceneMaker = (kit, tune) => {
  const p: ExecutionParams = { ...(kit.dark ? EXECUTION.dark : EXECUTION.light), ...tune };
  const { engine, w, h, rng, dark } = kit;
  const dir = kit.dir;
  const ink = new Ink(engine);
  const black = rgbOf(INK_BLACK);
  const paper = rgbOf(PAPER);
  const brand = kit.to.color;
  const short = Math.min(w, h);
  const dpr = engine.canvas.width / w;
  const owned: WebGLTexture[] = [];
  const own = (t: WebGLTexture) => (owned.push(t), t);

  const mark = kit.to.mark;
  engine.tex.logoB = engine.texture(mark.image);
  const box = mark.box;
  const heroUv: [number, number, number, number] = [box.x0 / MARK_MAP, box.y0 / MARK_MAP, box.x1 / MARK_MAP, box.y1 / MARK_MAP];
  const heroAspect = (box.x1 - box.x0) / Math.max(1, box.y1 - box.y0);
  const name = EXECUTION_NAMES[kit.to.site];
  const word = title(name, css(brand), INK_BLACK, PAPER);
  const titleTex = own(engine.texture(word.canvas));
  const stampTex = own(engine.texture(stamp(STAMP_RED, PAPER)));

  const tilt = (-p.panelTilt * Math.PI) / 180;
  const axis: P = [Math.cos(tilt), Math.sin(tilt)];
  const normal: P = [-axis[1], axis[0]];
  const centre: P = [w / 2, h * 0.47];
  const bandH = p.panelHeight * h;
  const along = (o: P, k: number, n = 0): P => [o[0] + axis[0] * k + normal[0] * n, o[1] + axis[1] * k + normal[1] * n];
  const heroRest = along(centre, -dir * w * 0.24);
  const heroH = p.heroSize * h;
  const titleScale = Math.min((0.17 * h) / word.height, (w * 0.5) / word.width);
  const titleCentre = along(centre, dir * w * 0.2, bandH * 0.08);

  const mirror = (q: P): P => (dir > 0 ? q : [w - q[0], q[1]]);
  const strikes = [
    [mirror([-0.08 * w, 0.12 * h]), mirror([1.08 * w, 0.86 * h])],
    [mirror([1.08 * w, 0.18 * h]), mirror([-0.08 * w, 0.74 * h])],
    [mirror([-0.08 * w, 0.6 * h]), mirror([1.08 * w, 0.3 * h])],
  ] as [P, P][];
  const strikeAt = [p.strike1, p.strike2, p.strike3];
  const impactAt = strikeAt.map((s) => s + p.cross);
  const widths = strikes.map(() => (p.strokeMin + rng() * (p.strokeMax - p.strokeMin)) * short);
  const strokes = strikes.map(([a, b], i) => new Brush(line(a, b, 72), widths[i], rng, 0.4));
  const rims = strikes.map(([a, b], i) => new Brush(line(a, b, 72), widths[i] * 1.3, rng, 0.45));
  const rimAlpha = dark ? 0.9 : 0;
  const gloss = strikes.map(([a, b], i) => new Brush(line(along(a, 0, -widths[i] * 0.12), along(b, 0, -widths[i] * 0.12), 72), widths[i] * 0.16, rng, 0.2));
  const spirals = [0, 1, 2].map((k) => {
    const path: P[] = [];
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const a = k * 2.1 + u * 4.2;
      const r = heroH * (0.5 + 0.35 * u + 0.08 * k);
      path.push([Math.cos(a) * r, Math.sin(a) * r * 0.8]);
    }
    return new Brush(path, short * (0.012 + 0.006 * k), rng, 0.5);
  });

  let pieces: Piece[] = [{ poly: [[0, 0], [w, 0], [w, h], [0, h]], cx: 0, cy: 0, sides: [], delay: 0, spin: 0, slide: [0, 0] }];
  strikes.forEach(([a, b]) => {
    pieces = pieces.flatMap((piece) => split(piece.poly, a, b).map((poly, s) => ({ ...piece, poly, sides: [...piece.sides, s ? 1 : -1] })));
  });
  pieces = pieces.filter((pc) => pc.poly.length >= 3);
  for (const pc of pieces) {
    pc.cx = pc.poly.reduce((s, q) => s + q[0], 0) / pc.poly.length;
    pc.cy = pc.poly.reduce((s, q) => s + q[1], 0) / pc.poly.length;
    pc.delay = rng() * 0.18;
    pc.spin = (rng() - 0.5) * 1.2;
    const [a, b] = strikes[2];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const side = pc.sides[2] ?? 1;
    pc.slide = [((b[0] - a[0]) / len) * 26 * side, ((b[1] - a[1]) / len) * 26 * side];
  }

  const particles: Particle[] = [];
  strikes.forEach(([a, b], k) => {
    const n = Math.round(p.splatter * (0.7 + rng() * 0.6));
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const nx = -(b[1] - a[1]) / len;
    const ny = (b[0] - a[0]) / len;
    for (let i = 0; i < n; i++) {
      const u = 0.1 + rng() * 0.8;
      const side = rng() < 0.5 ? -1 : 1;
      const speed = 120 + rng() * 520;
      particles.push({
        x: a[0] + (b[0] - a[0]) * u,
        y: a[1] + (b[1] - a[1]) * u,
        vx: nx * side * speed + (rng() - 0.5) * 160,
        vy: ny * side * speed + (rng() - 0.5) * 160,
        born: motion(impactAt[k]),
        life: 0.7 + rng() * 0.5,
        size: (3 + rng() * 8) * dpr,
        col: rng() < 0.25 && dark ? paper : black,
        frozen: true,
        fall: 0.35,
      });
    }
  });
  const stampPos = along(centre, dir * w * 0.36, -bandH * 0.32);
  for (let i = 0; i < 14; i++) {
    const a = rng() * Math.PI * 2;
    const s = 80 + rng() * 260;
    particles.push({ x: stampPos[0], y: stampPos[1], vx: Math.cos(a) * s, vy: Math.sin(a) * s, born: stampAt(p, name), life: 0.5, size: (2 + rng() * 4) * dpr, col: black, frozen: false, fall: 0.3 });
  }
  for (let i = 0; i < p.chips; i++) {
    const pc = pieces[Math.floor(rng() * pieces.length)];
    const [x, y] = inside(pc.poly, rng);
    particles.push({
      x,
      y,
      vx: (rng() - 0.5) * 240 + pc.slide[0] * 2,
      vy: -60 - rng() * 220,
      born: p.shot7 + pc.delay + 0.18 + rng() * 0.4,
      life: 0.6 + rng() * 0.5,
      size: (2 + rng() * 4) * dpr,
      col: rng() < 0.3 ? black : paper,
      frozen: false,
      fall: 1,
    });
  }
  for (let i = particles.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [particles[i], particles[j]] = [particles[j], particles[i]];
  }
  let live = particles.length;
  const dots = new Float32Array(particles.length * 7);

  function motion(sec: number): number {
    let s = sec;
    for (const at of impactAt) s -= Math.min(Math.max(sec - at, 0), p.hitStop);
    return s;
  }

  const fromTex = engine.tex.from ?? null;
  const pageTexel: [number, number] = [p.mangaEdge / w, p.mangaEdge / h];

  const sprite = (tex: WebGLTexture, c: P, sw: number, sh: number, angle: number, uv: [number, number, number, number], o: { alpha?: number; tint?: [number, number, number, number]; flip?: boolean } = {}) => {
    const ca = Math.cos(angle);
    const sa = Math.sin(angle);
    const corner = (x: number, y: number): P => [c[0] + x * ca - y * sa, c[1] + x * sa + y * ca];
    const [u0, v0, u1, v1] = uv;
    const [l, r] = o.flip ? [u1, u0] : [u0, u1];
    ink.quad(corner(-sw / 2, -sh / 2), corner(sw / 2, -sh / 2), corner(sw / 2, sh / 2), corner(-sw / 2, sh / 2), [l, v0], [r, v0], [r, v1], [l, v1], o.alpha ?? 1);
    ink.draw(INK.sprite, { tex, tint: o.tint });
  };
  const hero = (c: P, scale: number, o: { angle?: number; alpha?: number; tint?: [number, number, number, number]; flip?: boolean; stretch?: number } = {}) => {
    const hh = heroH * scale;
    sprite(engine.tex.logoB!, c, hh * heroAspect * (o.stretch ?? 1), hh, o.angle ?? 0, heroUv, o);
  };
  const band = (shift: number) => {
    const L = w * 1.4;
    const c = along(centre, shift);
    const pts: P[] = [along(c, -L, -bandH / 2), along(c, L, -bandH / 2), along(c, L, bandH / 2), along(c, -L, bandH / 2)];
    return pts;
  };
  const flat = (pts: P[], col: Rgb, alpha = 1) => {
    for (let i = 1; i < pts.length - 1; i++) for (const q of [pts[0], pts[i], pts[i + 1]]) engine.vertex([q[0], q[1], 0], [0, 0], { kind: KIND.flat, col, alpha });
  };
  const view = (dx: number, dy: number, zoom: number, focus: P) => {
    engine.view = [dx, dy, zoom, focus[0], focus[1]];
  };

  return {
    camera: 2.2,
    need: p.shot6 / p.end,
    count: pieces.length + particles.length,
    reduce: () => {
      if (live <= 60) return null;
      live = Math.floor(live / 2);
      return `${live} particles`;
    },
    dispose: () => {
      ink.dispose();
      owned.forEach((t) => engine.gl.deleteTexture(t));
    },
    draw: (t) => {
      const sec = t * p.end;
      const ms = motion(sec);
      const toTex = engine.tex.to ?? null;
      const sat = 1 + (p.saturation - 1) * out2(span(sec, 0, 0.2));
      const impact = impactAt.findIndex((at) => sec >= at && sec < at + p.impactFrames);

      let dx = 0;
      let dy = 0;
      for (const at of impactAt) {
        const u = span(sec, at, at + p.shakeDecay);
        if (u > 0 && u < 1) {
          const amp = p.shake * (1 - u) ** 2;
          dx += Math.sin(sec * 97) * amp;
          dy += Math.cos(sec * 83) * amp;
        }
      }
      [...name].forEach((c, i) => {
        const at = p.shot3 + i * p.letterGap;
        if (c.trim() && sec >= at && sec < at + 1 / 60) {
          dx += (i % 2 ? 1 : -1) * p.letterShake;
          dy += p.letterShake;
        }
      });
      const charge = sec >= p.shot4 && sec < p.shot5 ? in2(span(sec, p.shot4, p.shot5)) : 0;
      const heroAt = along(heroRest, -dir * w * 1.2 * (1 - expoOut(span(sec, p.shot2 + 0.12, p.shot2 + 0.12 + p.logoIn))));
      view(dx, dy, 1 + (p.zoom - 1) * charge, heroAt);

      if (impact >= 0) {
        engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.flat, col: paper });
        strokes.forEach((s, i) => i <= impact && s.draw(engine, 1, black));
        engine.flush();
        bars(sec);
        return;
      }

      const falling = sec >= p.shot7;
      if (falling) {
        const manga = 1 - inOut3(span(sec, p.shot8, p.shot8 + p.backToReal));
        ink.rect(0, 0, w, h);
        ink.draw(INK.page, { tex: toTex, manga, levels: p.mangaLevels, dot: p.mangaDot, texel: pageTexel, col2: black });
      }
      if (sec < impactAt[0]) {
        ink.rect(0, 0, w, h);
        ink.draw(INK.page, { tex: fromTex, sat });
      } else {
        for (const pc of pieces) {
          let ox = 0;
          let oy = 0;
          pc.sides.forEach((s, k) => {
            if (sec < impactAt[k]) return;
            const [a, b] = strikes[k];
            const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
            ox += (-(b[1] - a[1]) / len) * s * (p.cutGap / 2);
            oy += ((b[0] - a[0]) / len) * s * (p.cutGap / 2);
          });
          let angle = 0;
          let alpha = 1;
          if (falling) {
            const tau = sec - p.shot7 - pc.delay;
            if (tau > 0) {
              const slide = out2(span(tau, 0, 0.18));
              const drop = Math.max(0, tau - 0.12);
              ox += pc.slide[0] * slide;
              oy += pc.slide[1] * slide + 0.5 * p.gravity * drop * drop;
              angle = pc.spin * drop * drop * 1.6;
              alpha = 1 - smooth(0.32, 0.7, tau);
            }
          }
          if (alpha <= 0) continue;
          const ca = Math.cos(angle);
          const sa = Math.sin(angle);
          const map = (q: P): P => {
            const x = q[0] - pc.cx;
            const y = q[1] - pc.cy;
            return [pc.cx + ox + x * ca - y * sa, pc.cy + oy + x * sa + y * ca];
          };
          const m = pc.poly.map(map);
          for (let i = 1; i < m.length - 1; i++) {
            for (const k of [0, i, i + 1]) ink.vertex(m[k], [pc.poly[k][0] / w, pc.poly[k][1] / h], alpha);
          }
        }
        ink.draw(INK.page, { tex: fromTex, sat });
      }

      const lines = smooth(p.shot2, p.shot2 + 0.15, sec) * (1 - smooth(p.shot4 + 0.2, p.shot5 - 0.06, sec));
      if (lines > 0) {
        const o = kit.origin;
        const focus: P = o ? [o.x + o.w / 2, o.y + o.h / 2] : [w / 2, 0];
        ink.rect(0, 0, w, h, lines * (dark ? 0.4 : 0.55));
        ink.draw(INK.radial, { col: dark ? paper : black, a: [focus[0], focus[1], (sec - p.shot2) * 0.015, 140], b: [0.06, 0, 0, 0] });
      }
      const inPanel = sec >= p.shot2 && sec < p.shot5;
      if (inPanel) {
        const enter = -dir * w * 1.5 * (1 - expoOut(span(sec, p.shot2, p.shot2 + 0.28)));
        const leave = dir * w * 1.6 * in2(span(sec, p.shot4, p.shot4 + 0.45));
        const shift = enter + leave;
        const pts = band(shift);
        flat(pts, black, 0.94);
        engine.flush();
        ink.quad(pts[0], pts[1], pts[2], pts[3], [0, 0], [1, 0], [1, 1], [0, 1]);
        ink.draw(INK.halftone, { col: brand, a: [9, 0.04, 0.42, 0] });
        ink.quad(pts[0], pts[1], pts[2], pts[3], [0, 0], [1, 0], [1, 1], [0, 1], 0.5);
        ink.draw(INK.parallel, { col: paper, a: [axis[0] * -dir, axis[1] * -dir, sec * 2400, 9], b: [160, 0, 0, 0] });

        let x = -word.width / 2;
        word.glyphs.forEach((g, i) => {
          const at = p.shot3 + i * p.letterGap;
          const k = span(sec, at, at + p.letterDrop);
          if (g.w > 0 && sec >= at) {
            const scale = titleScale * (p.letterScale + (1 - p.letterScale) * out2(k));
            const c = along(titleCentre, shift + (x + g.advance / 2) * titleScale);
            sprite(titleTex, c, g.w * scale, g.h * scale, tilt, g.uv, { alpha: Math.min(1, k * 3) });
          }
          x += g.advance;
        });
        const st = stampAt(p, name);
        if (sec >= st) {
          const k = out2(span(sec, st, st + p.stampTime));
          const size = bandH * 0.55 * (p.stampScale + (1 - p.stampScale) * k);
          sprite(stampTex, along(stampPos, shift), size, size, tilt + (p.stampTurn * Math.PI) / 180, [0, 0, 1, 1], { alpha: Math.min(1, k * 4) });
        }
      }

      if (sec >= p.shot2 && sec < p.shot5) {
        if (charge > 0) {
          spirals.forEach((s, k) => {
            const turn = (sec - p.shot4) * (3 + k);
            s.draw(engine, Math.min(1, charge * 1.6), dark ? paper : black, 0.9, (q) => {
              const c = Math.cos(turn);
              const sn = Math.sin(turn);
              return [heroAt[0] + q[0] * c - q[1] * sn, heroAt[1] + q[0] * sn + q[1] * c];
            });
          });
          engine.flush();
        }
        hero(heroAt, 1, { angle: tilt * 0.4 });
      }

      if (sec >= p.shot5 - 0.05 && sec < p.shot5 - 0.05 + 1 / 60) {
        const r = (p.irisRadius * short) / engine.view[2];
        const ring: P[] = Array.from({ length: 48 }, (_, i) => [heroAt[0] + Math.cos((i / 48) * 6.283) * r, heroAt[1] + Math.sin((i / 48) * 6.283) * r]);
        flat(ring, paper);
        engine.flush();
        hero(heroAt, 1, { tint: [black[0], black[1], black[2], 1] });
      }

      if (sec >= p.strike1) {
        const dryness = smooth(p.shot6, p.sheathe - 0.05, sec);
        const fade = 1 - smooth(p.shot7, p.shot7 + 0.25, sec);
        strikes.forEach(([a, b], k) => {
          const u = span(ms, motion(strikeAt[k]), motion(strikeAt[k]) + p.cross);
          if (u <= 0 || fade <= 0) return;
          if (rimAlpha) rims[k].draw(engine, u, paper, rimAlpha * fade);
          strokes[k].draw(engine, u, black, fade);
          gloss[k].draw(engine, u, mixRgb(black, paper, 0.32), 0.5 * (1 - dryness) * fade);
          if (u < 1) {
            engine.flush();
            const angle = Math.atan2(b[1] - a[1], b[0] - a[0]);
            hero([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u], 0.62, { angle, stretch: 1.5, flip: b[0] < a[0] });
          }
        });
        engine.flush();
      }

      const after = impactAt[2] + p.hitStop;
      if (sec >= after) {
        const [a, b] = strikes[2];
        const edge: P = [dir > 0 ? w * 0.86 : w * 0.14, a[1] + (b[1] - a[1]) * (dir > 0 ? 0.86 : 0.14) - heroH * 0.18];
        const arrive = expoOut(span(sec, after, p.shot6));
        let c: P = [b[0] + (edge[0] - b[0]) * arrive, b[1] + (edge[1] - b[1]) * arrive];
        const drift = span(sec, p.shot6, p.shot7) * 6;
        c = [c[0] - dir * drift, c[1]];
        const sheath = span(sec, p.sheathe, p.sheathe + 0.08);
        let angle = dir * -0.07 * Math.sin(Math.PI * sheath);
        let scale = 0.7;
        let alpha = 1;
        const fly = inOut3(span(sec, p.shot8, p.shot8 + 0.65));
        if (fly > 0) {
          const o = kit.origin;
          const goal: P = o ? [o.x + o.w / 2, o.y + o.h / 2] : [w / 2, -20];
          const mid: P = [(c[0] + goal[0]) / 2, Math.min(c[1], goal[1]) - h * 0.25];
          const v = 1 - fly;
          c = [v * v * c[0] + 2 * v * fly * mid[0] + fly * fly * goal[0], v * v * c[1] + 2 * v * fly * mid[1] + fly * fly * goal[1]];
          scale *= 1 - 0.92 * fly;
          alpha = 1 - smooth(0.85, 1, fly);
          angle += fly * dir * 0.6;
        }
        if (alpha > 0) hero(c, scale, { angle, alpha, flip: dir > 0, tint: [black[0], black[1], black[2], 0.35 * (1 - fly)] });
      }

      let n = 0;
      for (let i = 0; i < live; i++) {
        const q = particles[i];
        const tau = (q.frozen ? ms : sec) - q.born;
        if (tau < 0 || tau > q.life) continue;
        const a = 1 - smooth(q.life * 0.55, q.life, tau);
        dots.set([q.x + q.vx * tau, q.y + q.vy * tau + 0.5 * p.gravity * q.fall * tau * tau, q.size, q.col[0], q.col[1], q.col[2], a], n * 7);
        n++;
      }
      ink.dots(dots, n);

      const vig = p.vignette * smooth(0, p.shot2, sec) * (1 - smooth(p.shot8, p.shot8 + p.backToReal, sec));
      if (vig > 0) {
        ink.rect(0, 0, w, h);
        ink.draw(INK.vignette, { col: black, a: [0.35, 1.05, vig, 0] });
      }
      bars(sec);
    },
  };

  function bars(sec: number): void {
    engine.view = [0, 0, 1, 0, 0];
    const k = expoOut(span(sec, 0, 0.3)) * (1 - inOut3(span(sec, p.end - p.barsOut, p.end)));
    const bh = p.bars * h * k;
    if (bh < 0.5) return;
    engine.rect(0, 0, w, bh, [0, 0, 1, 1], { kind: KIND.flat, col: black });
    engine.rect(0, h - bh, w, bh, [0, 0, 1, 1], { kind: KIND.flat, col: black });
    engine.flush();
  }
};

function split(poly: P[], a: P, b: P): [P[], P[]] {
  const side = (q: P) => (b[0] - a[0]) * (q[1] - a[1]) - (b[1] - a[1]) * (q[0] - a[0]);
  const left: P[] = [];
  const right: P[] = [];
  for (let i = 0; i < poly.length; i++) {
    const q = poly[i];
    const r = poly[(i + 1) % poly.length];
    const sq = side(q);
    const sr = side(r);
    (sq >= 0 ? left : right).push(q);
    if ((sq >= 0) !== (sr >= 0)) {
      const k = sq / (sq - sr);
      const x: P = [q[0] + (r[0] - q[0]) * k, q[1] + (r[1] - q[1]) * k];
      left.push(x);
      right.push(x);
    }
  }
  return [left, right];
}

function inside(poly: P[], rng: () => number): P {
  const i = 1 + Math.floor(rng() * (poly.length - 2));
  let u = rng();
  let v = rng();
  if (u + v > 1) [u, v] = [1 - u, 1 - v];
  const [a, b, c] = [poly[0], poly[i], poly[i + 1]];
  return [a[0] + (b[0] - a[0]) * u + (c[0] - a[0]) * v, a[1] + (b[1] - a[1]) * u + (c[1] - a[1]) * v];
}

function css(c: Rgb): string {
  return `rgb(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)})`;
}
