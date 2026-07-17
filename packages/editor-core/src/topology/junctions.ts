import type { Point, Vector } from '../geometry/primitives/point.js';
import {
  add,
  angleOf,
  cross,
  distance,
  normalize,
  perpendicular,
  scale,
  sub,
} from '../geometry/primitives/point.js';

/**
 * One wall end arriving at a junction. Pure descriptor — the wheel algorithm
 * never sees entities, so it is testable in isolation and reusable for any
 * future path-with-width geometry.
 */
export interface WallEnd {
  /** the shared junction point */
  readonly point: Point;
  /** unit vector pointing away from the junction, into the wall */
  readonly direction: Vector;
  /** half the wall thickness */
  readonly halfWidth: number;
}

/**
 * Resolved end cap for one wall: the two plan corners that replace its square
 * cap. `left` is on the +perpendicular(direction) side, `right` on the −side.
 */
export interface EndCap {
  readonly left: Point;
  readonly right: Point;
}

/** wall endpoints closer than this join automatically */
export const JOIN_TOLERANCE = 1e-4;

/** miter spike clamp, in multiples of the wider wall's halfWidth */
const MITER_LIMIT = 8;

/** infinite line × infinite line; null when parallel */
export function intersectLines(p1: Point, d1: Vector, p2: Point, d2: Vector): Point | null {
  const denom = cross(d1, d2);
  if (Math.abs(denom) < 1e-9) return null;
  const t = cross(sub(p2, p1), d2) / denom;
  return add(p1, scale(d1, t));
}

function squareCap(end: WallEnd): EndCap {
  const n = scale(perpendicular(end.direction), end.halfWidth);
  return { left: add(end.point, n), right: sub(end.point, n) };
}

function clampToLimit(pt: Point, junction: Point, limit: number): Point {
  if (distance(pt, junction) <= limit) return pt;
  return add(junction, scale(normalize(sub(pt, junction)), limit));
}

/**
 * Corner shared between wall `a` and its counter-clockwise neighbor `b`:
 * a's left face intersected with b's right face. Null when the faces are
 * parallel (collinear walls stay flush with square caps). Near-collinear
 * intersections are clamped to the miter limit so spikes stay bounded.
 */
function cornerBetween(a: WallEnd, b: WallEnd, junction: Point): Point | null {
  const pa = add(a.point, scale(perpendicular(a.direction), a.halfWidth));
  const pb = sub(b.point, scale(perpendicular(b.direction), b.halfWidth));
  const pt = intersectLines(pa, a.direction, pb, b.direction);
  if (!pt) return null;
  return clampToLimit(pt, junction, MITER_LIMIT * Math.max(a.halfWidth, b.halfWidth));
}

/**
 * T-junction cap: the ending wall butts against the continuous wall's near
 * face, described as the line through `facePoint` along `faceDir`. Both of
 * the ending wall's face lines are intersected with that face; at shallow
 * incidence the corners are clamped to the miter limit. Null when the ending
 * wall runs parallel to the face (no clean butt exists).
 */
export function resolveTeeCap(end: WallEnd, facePoint: Point, faceDir: Vector): EndCap | null {
  const n = scale(perpendicular(end.direction), end.halfWidth);
  const left = intersectLines(add(end.point, n), end.direction, facePoint, faceDir);
  const right = intersectLines(sub(end.point, n), end.direction, facePoint, faceDir);
  if (!left || !right) return null;
  const limit = MITER_LIMIT * end.halfWidth;
  return {
    left: clampToLimit(left, end.point, limit),
    right: clampToLimit(right, end.point, limit),
  };
}

/**
 * Junction wheel: sort ends by arrival angle, intersect each pair of
 * angle-adjacent faces once, hand each wall the two corners flanking it.
 * Adjacent walls therefore share corner points exactly. Caps are returned
 * aligned with the INPUT order.
 */
export function resolveJunction(ends: readonly WallEnd[]): EndCap[] {
  if (ends.length === 0) return [];
  if (ends.length === 1) return [squareCap(ends[0])];
  const junction = ends[0].point;
  const sorted = ends
    .map((end, index) => ({ end, index, angle: angleOf(end.direction) }))
    .sort((x, y) => x.angle - y.angle);
  const k = sorted.length;
  // corner i sits in the CCW gap between sorted wall i and sorted wall i+1
  const corners: (Point | null)[] = [];
  for (let i = 0; i < k; i++) {
    corners.push(cornerBetween(sorted[i].end, sorted[(i + 1) % k].end, junction));
  }
  const caps: EndCap[] = new Array(ends.length);
  for (let i = 0; i < k; i++) {
    const { end, index } = sorted[i];
    const square = squareCap(end);
    caps[index] = {
      left: corners[i] ?? square.left,
      right: corners[(i - 1 + k) % k] ?? square.right,
    };
  }
  return caps;
}
