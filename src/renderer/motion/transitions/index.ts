import type { TabTransition, TransitionId } from '../types';
import { none } from './none';
import { portal } from './portal';
import { travelling } from './travelling';
import { wave } from './wave';

export const transitions: Record<TransitionId, TabTransition> = { travelling, wave, portal, none };
