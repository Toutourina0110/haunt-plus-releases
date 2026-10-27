import { mulberry32 } from './math';

const FAMILY = '"Dela Gothic One"';
const SIZE = 150;
const STROKE = 14;
const SHADOW = 10;
let ready: Promise<boolean> | null = null;

export function loadLettering(): Promise<boolean> {
  ready ??= document.fonts
    .load(`${SIZE}px ${FAMILY}`, 'AHMNOSTU必殺')
    .then((faces) => faces.length > 0)
    .catch(() => false);
  return ready;
}

export interface Glyph {
  uv: [number, number, number, number];
  w: number;
  h: number;
  advance: number;
}

export interface Title {
  canvas: HTMLCanvasElement;
  glyphs: Glyph[];
  width: number;
  height: number;
}

const titles = new Map<string, Title>();

export function title(text: string, brand: string, ink: string, paper: string): Title {
  const key = `${text}|${brand}|${ink}|${paper}`;
  const cached = titles.get(key);
  if (cached) return cached;
  const probe = document.createElement('canvas').getContext('2d')!;
  probe.font = `${SIZE}px ${FAMILY}, sans-serif`;
  const pad = STROKE + SHADOW + 4;
  const chars = [...text];
  const advances = chars.map((c) => probe.measureText(c).width);
  const cellH = Math.ceil(SIZE * 1.3 + pad * 2);
  const cells = advances.map((a) => Math.ceil(a + pad * 2));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, cells.reduce((s, c) => s + c, 0));
  canvas.height = cellH;
  const g = canvas.getContext('2d')!;
  g.font = probe.font;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  let x = 0;
  const glyphs = chars.map((c, i) => {
    const cw = cells[i];
    if (c.trim()) {
      const ox = x + pad;
      const oy = cellH / 2;
      g.fillStyle = brand;
      g.strokeStyle = brand;
      g.lineWidth = STROKE;
      g.strokeText(c, ox + SHADOW, oy + SHADOW);
      g.fillText(c, ox + SHADOW, oy + SHADOW);
      g.strokeStyle = ink;
      g.strokeText(c, ox, oy);
      g.fillStyle = paper;
      g.fillText(c, ox, oy);
    }
    const glyph: Glyph = {
      uv: [x / canvas.width, 0, (x + cw) / canvas.width, 1],
      w: c.trim() ? cw : 0,
      h: cellH,
      advance: advances[i] + STROKE,
    };
    x += cw;
    return glyph;
  });
  const t = { canvas, glyphs, width: glyphs.reduce((s, gl) => s + gl.advance, 0), height: cellH };
  titles.set(key, t);
  return t;
}

let stampCanvas: HTMLCanvasElement | null = null;

export function stamp(red: string, paper: string): HTMLCanvasElement {
  if (stampCanvas) return stampCanvas;
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const g = c.getContext('2d')!;
  const rng = mulberry32(0x5fa11);
  const m = 18;
  g.fillStyle = red;
  g.beginPath();
  const side = (x0: number, y0: number, x1: number, y1: number) => {
    for (let i = 0; i <= 24; i++) {
      const k = i / 24;
      g.lineTo(x0 + (x1 - x0) * k + (rng() - 0.5) * 5, y0 + (y1 - y0) * k + (rng() - 0.5) * 5);
    }
  };
  g.moveTo(m, m);
  side(m, m, s - m, m);
  side(s - m, m, s - m, s - m);
  side(s - m, s - m, m, s - m);
  side(m, s - m, m, m);
  g.closePath();
  g.fill();
  g.strokeStyle = paper;
  g.lineWidth = 6;
  g.strokeRect(m + 14, m + 14, s - 2 * m - 28, s - 2 * m - 28);
  g.fillStyle = paper;
  g.font = `92px ${FAMILY}, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText('必', s / 2, s / 2 - 50);
  g.fillText('殺', s / 2, s / 2 + 50);
  g.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 26; i++) {
    g.beginPath();
    g.arc(m + rng() * (s - 2 * m), m + rng() * (s - 2 * m), 1 + rng() * 3.5, 0, Math.PI * 2);
    g.fill();
  }
  stampCanvas = c;
  return c;
}
