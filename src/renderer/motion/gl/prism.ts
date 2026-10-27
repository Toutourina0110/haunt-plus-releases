import { PRISM, type PrismParams } from '../../../shared/prism-params';
import { KIND, type Look, type Rgb } from './engine';
import { inOut3, mixRgb, ramp, shadeAt, smooth, span } from './math';
import type { SceneMaker } from './morph';

type V3 = [number, number, number];

export const prism: SceneMaker = (kit, tune) => {
  const p: PrismParams = { ...(kit.dark ? PRISM.dark : PRISM.light), ...tune };
  const { engine, w, h, dir } = kit;
  const n = Math.round(Math.min(p.maxBlades, Math.max(p.minBlades, w / p.bladeWidth)));
  engine.tex.logoA = engine.texture(kit.from.mark.image);
  engine.tex.logoB = engine.texture(kit.to.mark.image);
  const logoA = kit.logo(kit.from.mark);
  const logoB = kit.logo(kit.to.mark);
  const bgRamp = ramp(kit.from.bg, kit.to.bg);
  const waves = [p.wave1, p.wave2, p.wave3];
  const cx = w / 2;
  const cy = h / 2;

  return {
    camera: p.camera,
    need: p.hold,
    count: n * 4,
    draw: (t) => {
      const gap = p.gap * smooth(p.wave1, p.wave1 + 0.04, t) * (1 - smooth(0.96, 1, t));
      const s = 1 - p.recede * Math.sin(Math.PI * span(t, p.wave1, p.wave1 + p.stagger + p.quarter));
      const at = (x: number, y: number, z: number): V3 => [cx + (x - cx) * s, cy + (y - cy) * s, z];

      engine.rect(0, 0, w, h, [0, 0, 1, 1], { kind: KIND.flat, col: mixRgb(kit.from.bg, kit.to.bg, smooth(p.wave2, p.wave3, t)), shade: 0.55 });
      engine.flush();

      for (let i = 0; i < n; i++) {
        const x0 = (i * w) / n;
        const x1 = ((i + 1) * w) / n;
        const half = (x1 - x0) / 2;
        const key = dir > 0 ? (i + 0.5) / n : 1 - (i + 0.5) / n;
        const delay = key * p.stagger;
        let turns = 0;
        for (const start of waves) turns += inOut3(span(t, start + delay, start + delay + p.quarter));
        const k = inOut3(span(t, p.wave2 + delay, p.wave2 + delay + p.quarter));
        const col: Rgb = shadeAt(kit.ramp, k);
        const bg: Rgb = shadeAt(bgRamp, k);
        const theta = (turns * Math.PI) / 2;
        const xc = (x0 + x1) / 2;
        const zc = -half;
        const hw = half - gap / 2;
        const sx0 = x0 + gap / 2;
        const sx1 = x1 - gap / 2;

        for (let face = 0; face < 4; face++) {
          const a = dir * ((face * Math.PI) / 2 - theta);
          const cos = Math.cos(a);
          if (cos <= 0.001) continue;
          const sin = Math.sin(a);
          const fx = xc + sin * half;
          const fz = zc + cos * half;
          const lx = fx - cos * hw;
          const lz = fz + sin * hw;
          const rx = fx + cos * hw;
          const rz = fz - sin * hw;
          const shade = p.shadeBase + p.shadeAmp * cos;
          let look: Look;
          let uv: [[number, number], [number, number], [number, number], [number, number]];
          if (face === 0 || face === 3) {
            look = { kind: face === 0 ? KIND.from : KIND.to, shade };
            const u0 = sx0 / w;
            const u1 = sx1 / w;
            uv = [
              [u0, 0],
              [u1, 0],
              [u1, 1],
              [u0, 1],
            ];
          } else {
            const logo = face === 1 ? logoA : logoB;
            look = { kind: face === 1 ? KIND.logoA : KIND.logoB, shade, col, bg };
            const u0 = (sx0 - logo.x) / logo.size;
            const u1 = (sx1 - logo.x) / logo.size;
            const v0 = -logo.y / logo.size;
            const v1 = (h - logo.y) / logo.size;
            uv = [
              [u0, v0],
              [u1, v0],
              [u1, v1],
              [u0, v1],
            ];
          }
          engine.quad4([at(lx, 0, lz), at(rx, 0, rz), at(rx, h, rz), at(lx, h, lz)], uv, look);
        }
      }
      engine.flush({ depth: true, cull: true });
    },
  };
};
