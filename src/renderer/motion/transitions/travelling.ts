import { gsap } from 'gsap';
import { motionTokens } from '../tokens';
import type { TabTransition } from '../types';

export const travelling: TabTransition = {
  id: 'travelling',
  run: ({ stage, from, to, direction, dark }) => {
    const base = motionTokens.travelling;
    const t = dark ? base : { ...base, ...base.light };
    const step = stage.clientWidth * t.scale + t.gap;
    const far = { scale: t.scale, '--radius': `${t.radius}px`, '--dim': t.dim, '--edge': 1 };
    const halfPan = t.pan / 2;

    return gsap
      .timeline()
      .set([from, to], { transformOrigin: '50% 50%', willChange: 'transform, filter', immediateRender: true }, 0)
      .set(to, { x: direction * step, ...far, immediateRender: true }, 0)
      .to(from, { ...far, duration: t.shrink, ease: 'power3.out' }, 0)
      .to(from, { x: -direction * step, duration: t.pan, ease: 'power4.inOut' }, t.panStart)
      .to(to, { x: 0, duration: t.pan, ease: 'power4.inOut' }, t.panStart)
      .to([from, to], { '--blur': `${t.panBlur}px`, duration: halfPan, ease: 'sine.inOut' }, t.panStart)
      .to([from, to], { '--blur': '0px', duration: halfPan, ease: 'sine.inOut' }, t.panStart + halfPan)
      .to(to, { scale: 1, '--radius': '0px', '--dim': 1, '--edge': 0, duration: t.grow, ease: 'expo.out' }, t.growStart);
  },
};
