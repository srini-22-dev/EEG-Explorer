import { PATTERN_CATEGORIES } from './patterns';

/**
 * Category accent colour for each pattern id, so an on-trace cue can be tinted
 * to match the control-panel category it came from. Built from the single
 * registry in `patterns.ts` rather than duplicated, so the two never diverge.
 */
export const PATTERN_COLOR: Record<string, string> = Object.fromEntries(
  PATTERN_CATEGORIES.flatMap(c => c.patterns.map(p => [p.id, c.color])),
);
