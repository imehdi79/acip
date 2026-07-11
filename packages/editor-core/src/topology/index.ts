import type { Point } from '../geometry/primitives/point.js';

/**
 * Connectivity layer: loops, regions, boundary-with-holes, trim networks.
 * See docs/editor-core/02-architecture/layers.md. Region/boolean algorithms
 * land here when opening subtraction is implemented.
 */
export interface Loop {
  readonly points: readonly Point[];
}

export interface BoundaryWithHoles {
  readonly boundary: Loop;
  readonly holes: readonly Loop[];
}

export type { Interval } from './intervals.js';
export { mergeIntervals, subtractIntervals } from './intervals.js';
