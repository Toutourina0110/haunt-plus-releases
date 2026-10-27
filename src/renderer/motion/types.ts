import type { Box, StageMode } from '../../shared/types';

export type TransitionId = StageMode | 'none';

export interface TransitionContext {
  stage: HTMLElement;
  from: HTMLElement;
  to: HTMLElement;
  direction: 1 | -1;
  originRect: Box | null;
  dark: boolean;
}

export interface TabTransition {
  id: TransitionId;
  run: (ctx: TransitionContext) => gsap.core.Timeline;
}
