import { Delaunay } from 'd3-delaunay';
import { FRACTURE, type FractureParams } from '../../../shared/fracture-params';
import { KIND, type Rgb } from './engine';
import { inOut3, out3, shadeAt, smooth, span } from './math';
import type { SceneMaker } from './morph';

interface Shard {
  cx: number;
  cy: number;
  ring: number[];
  d: number;
  vx: number;
  vy: number;
  rx: number;
  ry: number;
  rz: number;
  depth: number;
  phase: number;
  back: Rgb;
}

interface Crack {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  near: number;
  far: number;
}

const RAD = Math.PI / 180;

export const fracture: SceneMaker = (kit, tune) => {
  const p: FractureParams = { ...(kit.dark ? FRACTURE.dark : FRACTURE.light), ...tune };
  const { engine, w, h, rng, dir } = kit;
  const ix = kit.origin ? Math.min(w, Math.max(0, kit.origin.x + kit.origin.w / 2)) : w / 2;
  const iy = 0;
  const maxD = Math.hypot(Math.max(ix, w - ix), h);
  const R = p.density * Math.min(w, h);

  const seeds: number[] = [];
  for (let tries = 0; seeds.length < p.shards * 2 && tries < p.shards * 400; tries++) {
    const x = rng() * w;
    const y = rng() * h;
    if (rng() < 1 / (1 + Math.hypot(x - ix, y - iy) / R)) seeds.push(x, y);
  }
  const voronoi = new Delaunay(Float64Array.from(seeds)).voronoi([0, 0, w, h]);

  const shards: Shard[] = [];
  const cracks = new Map<string, Crack>();
  const onBorder = (x: number, y: number) => x < 0.5 || y < 0.5 || x > w - 0.5 || y > h - 0.5;
  const dist = (x: number, y: number) => Math.hypot(x - ix, y - iy) / maxD;
  for (let i = 0; i < seeds.length / 2; i++) {
    const poly = voronoi.cellPolygon(i);
    if (!poly || poly.length < 4) continue;
    const pts = poly.slice(0, -1);
    let cx = 0;
    let cy = 0;
    let area = 0;
    for (let k = 0; k < pts.length; k++) {
      const [x0, y0] = pts[k];
      const [x1, y1] = pts[(k + 1) % pts.length];
      cx += x0;
      cy += y0;
      area += x0 * y1 - x1 * y0;
      const key = [x0, y0, x1, y1].map((v) => Math.round(v * 4)).join(x0 < x1 || (x0 === x1 && y0 < y1) ? ',' : ';');
      const same = [x1, y1, x0, y0].map((v) => Math.round(v * 4)).join(x1 < x0 || (x1 === x0 && y1 < y0) ? ',' : ';');
      if ((onBorder(x0, y0) && onBorder(x1, y1)) || cracks.has(key) || cracks.has(same)) continue;
      const d0 = dist(x0, y0);
      const d1 = dist(x1, y1);
      cracks.set(
        key,
        d0 <= d1 ? { ax: x0, ay: y0, bx: x1, by: y1, near: d0, far: d1 } : { ax: x1, ay: y1, bx: x0, by: y0, near: d1, far: d0 },
      );
    }
    cx /= pts.length;
    cy /= pts.length;
    if (area < 0) pts.reverse();
    const d = dist(cx, cy);
    const len = Math.hypot(cx - ix, cy - iy) || 1;
    const push = p.speed * Math.min(w, h) * (0.35 + 0.65 / (1 + (d * maxD) / R));
    const sign = () => (rng() < 0.5 ? -1 : 1);
    shards.push({
      cx,
      cy,
      ring: pts.flatMap(([x, y]) => [x - cx, y - cy]),
      d,
      vx: ((cx - ix) / len) * push,
      vy: ((cy - iy) / len) * push,
      rx: p.rotX * RAD * (0.4 + 0.6 * rng()) * sign(),
      ry: p.rotY * RAD * (0.4 + 0.6 * rng()) * sign(),
      rz: p.rotZ * RAD * (rng() * 2 - 1),
      depth: p.depth * (0.5 + 0.5 * rng()),
      phase: rng() * Math.PI * 2,
      back: shadeAt(kit.ramp, dir > 0 ? cx / w : 1 - cx / w),
    });
  }
  const lines = [...cracks.values()];
  engine.tex.logoB = engine.texture(kit.to.mark.image);
  const logo = kit.logo(kit.to.mark);
  const crackCol: Rgb = kit.dark ? [1, 1, 1] : [0, 0, 0];

  return {
    camera: p.camera,
    need: p.hold,
    count: shards.length,
    draw: (t, frame) => {
      const s = frame === 1 ? 1 - p.impact : 1;
      const at = (x: number, y: number, z: number): [number, number, number] => [w / 2 + (x - w / 2) * s, h / 2 + (y - h / 2) * s, z];

      const whole = t <= p.burstStart || t >= p.returnEnd;
      if (whole) {
        const [x0, y0] = at(0, 0, 0);
        const [x1, y1] = at(w, h, 0);
        engine.rect(x0, y0, x1 - x0, y1 - y0, [0, 0, 1, 1], { kind: t >= p.returnEnd ? KIND.to : KIND.from });
      } else engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.flat, col: kit.to.bg });
      const logoAlpha = smooth(p.burstStart, p.burstEnd - 0.08, t) * (1 - smooth(p.returnStart, p.returnEnd - 0.06, t));
      if (logoAlpha > 0) {
        engine.rect(logo.x, logo.y, logo.size, logo.size, [0, 0, 1, 1], { kind: KIND.logoB, col: kit.to.color, bg: kit.to.bg, alpha: logoAlpha });
      }
      engine.flush();

      for (const sh of whole ? [] : shards) {
        const burst = out3(span(t, p.burstStart + sh.d * p.burstStagger, p.burstEnd));
        const back = inOut3(span(t, p.returnStart + (1 - sh.d) * p.returnStagger, p.returnEnd));
        const away = burst * (1 - back);
        const float = smooth(p.burstEnd - 0.06, p.burstEnd, t) * (1 - back);
        const ox = sh.vx * away + Math.sin(t * 9 + sh.phase) * p.drift * float;
        const oy = sh.vy * away + p.gravity * h * burst * burst * (1 - back) + Math.cos(t * 7 + sh.phase) * p.drift * float;
        const oz = -sh.depth * away;
        const [sx, cx] = [Math.sin(sh.rx * away), Math.cos(sh.rx * away)];
        const [sy, cy] = [Math.sin(sh.ry * away), Math.cos(sh.ry * away)];
        const [sz, cz] = [Math.sin(sh.rz * away), Math.cos(sh.rz * away)];
        const m00 = cz * cy;
        const m01 = cz * sy * sx - sz * cx;
        const m10 = sz * cy;
        const m11 = sz * sy * sx + cz * cx;
        const m20 = -sy;
        const m21 = cy * sx;
        const nz = cy * cx;
        const look = {
          kind: KIND.from,
          toMix: smooth(0.25, 0.6, back),
          shade: p.shadeBase + p.shadeAmp * Math.abs(nz),
          col: sh.back,
        };
        const point = (rx: number, ry: number) =>
          at(sh.cx + ox + m00 * rx + m01 * ry, sh.cy + oy + m10 * rx + m11 * ry, oz + m20 * rx + m21 * ry);
        const centre = point(0, 0);
        const uvc: [number, number] = [sh.cx / w, sh.cy / h];
        const n = sh.ring.length / 2;
        for (let k = 0; k < n; k++) {
          const ax = sh.ring[k * 2];
          const ay = sh.ring[k * 2 + 1];
          const bx = sh.ring[((k + 1) % n) * 2];
          const by = sh.ring[((k + 1) % n) * 2 + 1];
          engine.vertex(centre, uvc, look);
          engine.vertex(point(ax, ay), [(sh.cx + ax) / w, (sh.cy + ay) / h], look);
          engine.vertex(point(bx, by), [(sh.cx + bx) / w, (sh.cy + by) / h], look);
        }
      }
      engine.flush({ depth: true, back: true });

      const reach = span(t, p.cracksStart, p.cracksEnd);
      const before = 1 - smooth(p.burstStart, p.burstStart + 0.06, t);
      const after = smooth(p.healStart - 0.04, p.healStart, t);
      for (const c of lines) {
        const grown = Math.min(1, Math.max(0, (reach - c.near) / Math.max(0.001, c.far - c.near)));
        const delay = (1 - c.near) * 0.06;
        const healed = span(t, p.healStart + delay, p.healStart + delay + 0.04);
        const early = grown > 0 ? before : 0;
        const late = after * (1 - healed);
        const alpha = p.crackAlpha * Math.max(early, late);
        if (alpha <= 0.004) continue;
        const k = late > early ? 1 : grown;
        const a = at(c.ax, c.ay, 0);
        const b = at(c.ax + (c.bx - c.ax) * k, c.ay + (c.by - c.ay) * k, 0);
        engine.line([a[0], a[1]], [b[0], b[1]], { kind: KIND.flat, col: crackCol, alpha });
      }
      engine.flush({ lines: true });
    },
  };
};
