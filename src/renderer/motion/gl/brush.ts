import { KIND, type GlEngine, type Rgb } from './engine';

type P = [number, number];

export class Brush {
  private readonly left: P[] = [];
  private readonly right: P[] = [];
  private readonly at: number[] = [];

  constructor(path: P[], width: number, rng: () => number, rough = 0.35) {
    let total = 0;
    const lengths = [0];
    for (let i = 1; i < path.length; i++) {
      total += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]);
      lengths.push(total);
    }
    const wave = () => {
      const f = 2 + rng() * 5;
      const p = rng() * 6.28;
      return (u: number) => Math.sin(u * f * 6.28 + p);
    };
    const [l1, l2, r1, r2] = [wave(), wave(), wave(), wave()];
    path.forEach((p, i) => {
      const u = total ? lengths[i] / total : 0;
      const prev = path[Math.max(0, i - 1)];
      const next = path[Math.min(path.length - 1, i + 1)];
      const dx = next[0] - prev[0];
      const dy = next[1] - prev[1];
      const d = Math.hypot(dx, dy) || 1;
      const nx = -dy / d;
      const ny = dx / d;
      const body = Math.sin(Math.PI * Math.min(1, Math.max(0, u * 0.9 + 0.05))) ** 0.6;
      const jitter = () => (rng() - 0.5) * rough * 0.5;
      const half = (width / 2) * body;
      const wl = half * (1 + rough * (0.6 * l1(u) + 0.4 * l2(u)) + jitter());
      const wr = half * (1 + rough * (0.6 * r1(u) + 0.4 * r2(u)) + jitter());
      this.left.push([p[0] + nx * wl, p[1] + ny * wl]);
      this.right.push([p[0] - nx * wr, p[1] - ny * wr]);
      this.at.push(u);
    });
  }

  draw(engine: GlEngine, upto: number, col: Rgb, alpha = 1, map: (p: P) => P = (p) => p): void {
    const look = { kind: KIND.flat, col, alpha };
    for (let i = 1; i < this.at.length; i++) {
      if (this.at[i - 1] >= upto) break;
      const k = this.at[i] <= upto ? 1 : (upto - this.at[i - 1]) / (this.at[i] - this.at[i - 1]);
      const l0 = map(this.left[i - 1]);
      const r0 = map(this.right[i - 1]);
      const l1 = map(lerpP(this.left[i - 1], this.left[i], k));
      const r1 = map(lerpP(this.right[i - 1], this.right[i], k));
      engine.vertex([l0[0], l0[1], 0], [0, 0], look);
      engine.vertex([l1[0], l1[1], 0], [0, 0], look);
      engine.vertex([r1[0], r1[1], 0], [0, 0], look);
      engine.vertex([l0[0], l0[1], 0], [0, 0], look);
      engine.vertex([r1[0], r1[1], 0], [0, 0], look);
      engine.vertex([r0[0], r0[1], 0], [0, 0], look);
    }
  }
}

function lerpP(a: P, b: P, k: number): P {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}

export function line(a: P, b: P, steps = 48): P[] {
  return Array.from({ length: steps + 1 }, (_, i) => lerpP(a, b, i / steps));
}
