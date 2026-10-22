import type { WebContents } from 'electron';
import type { Box } from '../shared/types';

export const MAX_ELEMENTS = 60;

const WORLD = 1001;

function scan(max: number): number[] {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const started = performance.now();
  const media = new Set(['IMG', 'SVG', 'VIDEO', 'CANVAS', 'PICTURE', 'IFRAME']);
  const controls = new Set(['BUTTON', 'INPUT', 'SELECT', 'TEXTAREA']);
  const blocks = new Set(['H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'P', 'LI', 'BLOCKQUOTE', 'PRE', 'LABEL', 'FIGCAPTION', 'TD', 'TH', 'DT', 'DD']);
  const kept = new Set<Element>();
  const found: Array<[number, number, number, number]> = [];

  const alpha = (color: string): number => {
    if (!color || color === 'transparent') return 0;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(color);
    if (slash) return parseFloat(slash[1]) / (slash[2] ? 100 : 1);
    const parts = (/\(([^)]*)\)/.exec(color)?.[1] ?? '').split(',');
    return parts.length === 4 ? parseFloat(parts[3]) : 1;
  };

  const behind = (el: Element | null): string => {
    for (let node = el; node; node = node.parentElement) {
      const bg = getComputedStyle(node).backgroundColor;
      if (alpha(bg) > 0.05) return bg;
    }
    return '';
  };

  const borders = (cs: CSSStyleDeclaration): number =>
    ['top', 'right', 'bottom', 'left'].filter(
      (side) =>
        parseFloat(cs.getPropertyValue(`border-${side}-width`)) >= 1 &&
        !['none', 'hidden'].includes(cs.getPropertyValue(`border-${side}-style`)) &&
        alpha(cs.getPropertyValue(`border-${side}-color`)) > 0.1,
    ).length;

  const ownText = (el: Element): boolean => {
    for (const node of el.childNodes) {
      if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim().length > 1) return true;
    }
    return false;
  };

  for (const el of document.body ? document.body.querySelectorAll('*') : []) {
    if (performance.now() - started > 60) break;
    const r = el.getBoundingClientRect();
    const x0 = Math.max(0, r.left);
    const y0 = Math.max(0, r.top);
    const w = Math.min(vw, r.right) - x0;
    const h = Math.min(vh, r.bottom) - y0;
    if (w < 10 || h < 10) continue;
    if (w * h > vw * vh * 0.4 || (w > vw * 0.9 && h > vh * 0.5)) continue;

    let nested = false;
    for (let up = el.parentElement; up && !nested; up = up.parentElement) nested = kept.has(up);
    if (nested) continue;
    if (!el.checkVisibility({ opacityProperty: true, visibilityProperty: true })) continue;

    const tag = el.tagName.toUpperCase();
    const cs = getComputedStyle(el);
    let significant =
      media.has(tag) || controls.has(tag) || (blocks.has(tag) && (el.textContent ?? '').trim().length > 0);
    if (!significant) {
      significant =
        cs.backgroundImage !== 'none' ||
        (alpha(cs.backgroundColor) > 0.05 && cs.backgroundColor !== behind(el.parentElement)) ||
        borders(cs) >= 2 ||
        cs.boxShadow !== 'none' ||
        (cs.display !== 'inline' && ownText(el));
    }
    if (!significant) continue;
    kept.add(el);
    found.push([x0, y0, w, h]);
  }

  found.sort((a, b) => b[2] * b[3] - a[2] * a[3]);
  return found.slice(0, max).flatMap((box) => box.map((v) => Math.round(v)));
}

export async function detectElements(wc: WebContents): Promise<Box[]> {
  let raw: unknown;
  try {
    raw = await wc.executeJavaScriptInIsolatedWorld(WORLD, [{ code: `(${scan.toString()})(${MAX_ELEMENTS})` }]);
  } catch {
    return [];
  }
  if (!Array.isArray(raw)) return [];
  const zoom = wc.getZoomFactor();
  const boxes: Box[] = [];
  for (let i = 0; i + 3 < raw.length && boxes.length < MAX_ELEMENTS; i += 4) {
    const [x, y, w, h] = raw.slice(i, i + 4) as unknown[];
    if (![x, y, w, h].every((v) => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 20000)) continue;
    if ((w as number) < 1 || (h as number) < 1) continue;
    boxes.push({ x: (x as number) * zoom, y: (y as number) * zoom, w: (w as number) * zoom, h: (h as number) * zoom });
  }
  return boxes;
}
