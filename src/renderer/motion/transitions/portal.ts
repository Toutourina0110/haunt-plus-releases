import { gsap } from 'gsap';
import { motionTokens } from '../tokens';
import type { TabTransition } from '../types';

export const portal: TabTransition = {
  id: 'portal',
  run: ({ stage, from, to, originRect, dark }) => {
    const base = motionTokens.portal;
    const t = dark ? base : { ...base, ...base.light };
    const w = stage.clientWidth;
    const h = stage.clientHeight;
    const tab = originRect ?? { x: w / 2 - 17, y: 0, w: 34, h: 28 };
    const left = Math.min(Math.max(tab.x, 0), w);
    const right = Math.min(Math.max(w - (tab.x + tab.w), 0), w);
    const origin = `${tab.x + tab.w / 2}px 0px`;
    const content = to.querySelector<HTMLElement>('.panel-content');
    const items = [...to.querySelectorAll<HTMLElement>('[data-motion="item"]')];

    const tl = gsap
      .timeline()
      .set(from, { transformOrigin: origin, willChange: 'transform, opacity, filter', immediateRender: true }, 0)
      .fromTo(
        from,
        { scale: 1, opacity: 1, filter: 'blur(0px) brightness(1)' },
        {
          scale: t.recedeScale,
          opacity: t.recedeOpacity,
          filter: `blur(${t.blur}px) brightness(${t.dim})`,
          duration: t.recede,
          ease: 'power3.out',
        },
        0,
      )
      .fromTo(
        to,
        { clipPath: `inset(0px ${right}px ${h - t.pill}px ${left}px round 999px)` },
        { clipPath: 'inset(0px 0px 0px 0px round 0px)', duration: t.open, ease: 'power3.inOut' },
        0,
      );
    if (content) {
      tl.fromTo(
        content,
        { transformOrigin: origin, scale: t.counterScale, filter: `blur(${t.counterBlur}px)` },
        { scale: 1, filter: 'blur(0px)', duration: t.counterZoom, ease: 'expo.out' },
        0,
      );
    }
    if (items.length) {
      tl.fromTo(
        items,
        { opacity: 0, y: t.itemY, scale: t.itemScale, filter: `blur(${t.itemBlur}px)` },
        {
          opacity: 1,
          y: 0,
          scale: 1,
          filter: 'blur(0px)',
          duration: t.itemIn,
          ease: 'expo.out',
          stagger: { each: Math.min(t.staggerMax, t.staggerTotal / items.length), grid: 'auto', from: 'start' },
        },
        t.itemsAt,
      );
    }
    return tl;
  },
};
