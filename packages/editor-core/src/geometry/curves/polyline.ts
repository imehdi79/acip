import type { Point, Vector } from '../primitives/point.js';
import { distance, lerp, normalize, sub } from '../primitives/point.js';
import { closestParamOnSegment, distanceToSegment } from './segment.js';

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
    best = Math.min(
      best,
      distanceToSegment(p, points[points.length - 1], points[0]),
    );
  }
  return best;
}

/** total length walked along the polyline */
export function polylineLength(points: readonly Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += distance(points[i - 1], points[i]);
  }
  return total;
}

/** a point on a polyline and the direction of travel there */
export interface PolylineFrame {
  readonly point: Point;
  readonly tangent: Vector;
}

/**
 * The frame at `t` — a fraction of the polyline's TOTAL LENGTH, not of its
 * segment count, so a point stays where it is when the polyline is
 * re-tessellated with more or fewer points.
 *
 * Arc-length parametrisation is what lets anything placed along a line stay
 * put when that line stops being straight: a window at t = 0.5 is halfway
 * along the wall whether the wall is a chord or a bow.
 *
 * Null for a polyline with nothing to walk along.
 */
export function polylineFrameAt(
  points: readonly Point[],
  t: number,
): PolylineFrame | null {
  if (points.length < 2) return null;
  // A straight run answers exactly what the segment math always did: the same
  // lerp, the same normalize, no walk and no arc-length round trip to drift
  // through. Every wall that has not been curved takes this path.
  if (points.length === 2) {
    const [a, b] = points;
    if (distance(a, b) === 0) return null;
    return { point: lerp(a, b, t), tangent: normalize(sub(b, a)) };
  }
  const total = polylineLength(points);
  if (total === 0) return null;
  let target = t * total;
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i]);
    if (seg === 0) continue;
    if (target <= seg || i === points.length - 1) {
      const local = Math.min(1, Math.max(0, target / seg));
      return {
        point: lerp(points[i - 1], points[i], local),
        tangent: normalize(sub(points[i], points[i - 1])),
      };
    }
    target -= seg;
  }
  return null;
}

/**
 * How far along the polyline the closest point to `p` sits, as a fraction of
 * its total length — the inverse of `polylineFrameAt`, and what a drag onto
 * the line reads back as.
 */
export function closestParamOnPolyline(
  p: Point,
  points: readonly Point[],
): number {
  if (points.length < 2) return 0;
  if (points.length === 2) {
    return closestParamOnSegment(p, points[0], points[1]);
  }
  const total = polylineLength(points);
  if (total === 0) return 0;
  let walked = 0;
  let best = { d: Infinity, at: 0 };
  for (let i = 1; i < points.length; i++) {
    const seg = distance(points[i - 1], points[i]);
    if (seg > 0) {
      const local = closestParamOnSegment(p, points[i - 1], points[i]);
      const d = distance(p, lerp(points[i - 1], points[i], local));
      if (d < best.d) best = { d, at: (walked + local * seg) / total };
    }
    walked += seg;
  }
  return best.at;
}
