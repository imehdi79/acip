import type { Point } from '../primitives/point.js';
import { add, dot, distance, scale, sub } from '../primitives/point.js';

export function closestParamOnSegment(p: Point, a: Point, b: Point): number {
  const ab = sub(b, a);
  const lenSq = dot(ab, ab);
  if (lenSq === 0) return 0;
  const t = dot(sub(p, a), ab) / lenSq;
  return Math.max(0, Math.min(1, t));
}

export function closestPointOnSegment(p: Point, a: Point, b: Point): Point {
  const t = closestParamOnSegment(p, a, b);
  return add(a, scale(sub(b, a), t));
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  return distance(p, closestPointOnSegment(p, a, b));
}
