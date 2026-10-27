import type { GlMode } from '../../../shared/types';
import type { GlEngine } from './engine';
import { dust, dustProgram } from './dust';
import { fracture } from './fracture';
import type { SceneMaker } from './morph';
import { prism } from './prism';
import { execution } from '../execution';
import { inkProgram, pointProgram } from './ink';

export const scenes: Record<GlMode, SceneMaker> = { prism, fracture, dust, execution };

export function warm(engine: GlEngine): void {
  dustProgram(engine);
  inkProgram(engine);
  pointProgram(engine);
}
