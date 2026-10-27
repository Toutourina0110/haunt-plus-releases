import { gsap } from 'gsap';
import type { TabTransition } from '../types';

export const none: TabTransition = {
  id: 'none',
  run: () => gsap.timeline(),
};
