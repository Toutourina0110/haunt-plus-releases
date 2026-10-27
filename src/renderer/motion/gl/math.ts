import type { Rgb } from './engine';

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seedOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a: number, b: number, k: number): number => a + (b - a) * k;
export const span = (t: number, a: number, b: number): number => clamp01((t - a) / (b - a));
export const smooth = (a: number, b: number, t: number): number => {
  const u = span(t, a, b);
  return u * u * (3 - 2 * u);
};
export const inOut3 = (u: number): number => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2);
export const out3 = (u: number): number => 1 - (1 - u) ** 3;

export function rgbOf(hex: string): Rgb {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function mixRgb(a: Rgb, b: Rgb, k: number): Rgb {
  return [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];
}

export const SHADES = 64;
export function ramp(a: Rgb, b: Rgb): Rgb[] {
  return Array.from({ length: SHADES + 1 }, (_, i) => mixRgb(a, b, i / SHADES));
}
export const shadeAt = (r: Rgb[], k: number): Rgb => r[Math.round(clamp01(k) * SHADES)];

export function hilbert(x: number, y: number): number {
  const n = 1024;
  let d = 0;
  let px = Math.min(n - 1, Math.max(0, Math.floor(x)));
  let py = Math.min(n - 1, Math.max(0, Math.floor(y)));
  for (let s = n >> 1; s > 0; s >>= 1) {
    const rx = (px & s) > 0 ? 1 : 0;
    const ry = (py & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) {
        px = n - 1 - px;
        py = n - 1 - py;
      }
      [px, py] = [py, px];
    }
  }
  return d;
}
