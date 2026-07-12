import type { Point } from '../primitives/point.js';
import { distanceToSegment } from './segment.js';

export function distanceToPolyline(
  p: Point,
  points: readonly Point[],
  closed: boolean,
): number {
  if (points.length === 0) return Infinity;
  if (points.length === 1) return distanceToSegment(p, points[0], points[0]);
  let best = Infinity;
  for (let i = 1; i < points.length; i++) {
    best = Math.min(best, distanceToSegment(p, points[i - 1], points[i]));
  }
  if (closed) {
    best = Math.min(best, distanceToSegment(p, points[points.length - 1], points[0]));
  }
  return best;
}
