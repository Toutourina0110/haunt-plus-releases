import { gsap } from 'gsap';
import { projectOnGradient, rectIn, solveEase } from '../geometry';
import { motionTokens } from '../tokens';
import type { TabTransition } from '../types';

export const wave: TabTransition = {
  id: 'wave',
  run: ({ stage, from, to, direction, dark }) => {
    const base = motionTokens.wave;
    const t = dark ? base : { ...base, ...base.light };
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const angle = direction === 1 ? t.angle : t.angle + 180;
    const ease = gsap.parseEase(t.sweepEase);
    const end = 1 + t.edge;
    const reach = (el: HTMLElement) => {
      const at = projectOnGradient(rectIn(el, stage), w, h, angle);
      return solveEase(ease, (at - t.start) / (end - t.start)) * t.sweep;
    };
    const cards = (panel: HTMLElement) =>
      [...panel.querySelectorAll<HTMLElement>('[data-motion="item"]')].map((el) => ({ el, at: reach(el) }));

    const tl = gsap
      .timeline()
      .set(to, { '--wave-angle': `${angle}deg`, '--wave-edge': `${t.edge * 100}%`, '--wave': t.start, immediateRender: true }, 0)
      .to(to, { '--wave': end, duration: t.sweep, ease: t.sweepEase }, 0)
      .to(from, { '--dim': t.dim, duration: t.dimTime, ease: 'power1.out' }, 0);

    for (const { el, at } of cards(from)) {
      tl.to(
        el,
        { opacity: 0, y: -t.outY, scale: t.outScale, filter: `blur(${t.outBlur}px)`, duration: t.itemOut, ease: 'power2.in' },
        Math.max(0, at - t.itemLead),
      );
    }
    for (const { el, at } of cards(to)) {
      tl.fromTo(
        el,
        { opacity: 0, x: t.inX * direction, y: t.inY, scale: t.inScale, filter: `blur(${t.inBlur}px)` },
        { opacity: 1, x: 0, y: 0, scale: 1, filter: 'blur(0px)', duration: t.itemIn, ease: 'expo.out' },
        at,
      );
    }
    return tl;
  },
};
