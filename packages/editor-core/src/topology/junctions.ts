import type { Point, Vector } from '../geometry/primitives/point.js';
import {
  add,
  angleOf,
  cross,
  dot,
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
export function intersectLines(
  p1: Point,
  d1: Vector,
  p2: Point,
  d2: Vector,
): Point | null {
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
  return clampToLimit(
    pt,
    junction,
    MITER_LIMIT * Math.max(a.halfWidth, b.halfWidth),
  );
}

/**
 * T-junction cap: the ending wall butts against the continuous wall's near
 * face, described as the line through `facePoint` along `faceDir`. Both of
 * the ending wall's face lines are intersected with that face; at shallow
 * incidence the corners are clamped to the miter limit. Null when the ending
 * wall runs parallel to the face (no clean butt exists).
 */
export function resolveTeeCap(
  end: WallEnd,
  facePoint: Point,
  faceDir: Vector,
): EndCap | null {
  const n = scale(perpendicular(end.direction), end.halfWidth);
  const left = intersectLines(
    add(end.point, n),
    end.direction,
    facePoint,
    faceDir,
  );
  const right = intersectLines(
    sub(end.point, n),
    end.direction,
    facePoint,
    faceDir,
  );
  if (!left || !right) return null;
  const limit = MITER_LIMIT * end.halfWidth;
  return {
    left: clampToLimit(left, end.point, limit),
    right: clampToLimit(right, end.point, limit),
  };
}

/** sine of the angle below which two ends count as one straight run (~0.06°) */
const COLLINEAR_SIN = 1e-3;

/** does `b` carry on where `a` came from — one wall passing straight through? */
function continues(a: Vector, b: Vector): boolean {
  return Math.abs(cross(a, b)) <= COLLINEAR_SIN && dot(a, b) < 0;
}

/**
 * Junction wheel: sort ends by arrival angle, intersect each pair of
 * angle-adjacent faces once, hand each wall the two corners flanking it.
 * Adjacent walls therefore share corner points exactly. Caps are returned
 * aligned with the INPUT order.
 *
 * One case never reaches the wheel: a wall that RUNS STRAIGHT THROUGH the
 * junction, because another end carries on along its line. The wheel resolves
 * each side of such a wall on its own — parallel faces on the through side,
 * a miter on the other — which chamfers its cap and leaves a triangular hole
 * above the wall arriving from the side. Instead the run keeps a square cap on
 * both faces, filling the crossing, and the arriving walls butt against the
 * face it presents. That is the ordinary drafting cleanup: the continuous wall
 * stays continuous, the others stop at its face.
 */
export function resolveJunction(ends: readonly WallEnd[]): EndCap[] {
  if (ends.length === 0) return [];
  if (ends.length === 1) return [squareCap(ends[0])];
  const junction = ends[0].point;

  const throughRun = ends.map((end, i) =>
    ends.some(
      (other, j) => j !== i && continues(end.direction, other.direction),
    ),
  );
  const first = throughRun.indexOf(true);
  if (first >= 0) {
    // the thickest wall of the run owns the face the others stop at, so a
    // thin partition never pokes through a thick wall it butts into
    const halfWidth = Math.max(
      ...ends.filter((_, i) => throughRun[i]).map((end) => end.halfWidth),
    );
    const along = ends[first].direction;
    const n = perpendicular(along);
    return ends.map((end, i) => {
      if (throughRun[i]) return squareCap(end);
      const side = dot(end.direction, n) >= 0 ? 1 : -1;
      return (
        resolveTeeCap(end, add(junction, scale(n, side * halfWidth)), along) ??
        squareCap(end)
      );
    });
  }
  const sorted = ends
    .map((end, index) => ({ end, index, angle: angleOf(end.direction) }))
    .sort((x, y) => x.angle - y.angle);
  const k = sorted.length;
  // corner i sits in the CCW gap between sorted wall i and sorted wall i+1
  const corners: (Point | null)[] = [];
  for (let i = 0; i < k; i++) {
    corners.push(
      cornerBetween(sorted[i].end, sorted[(i + 1) % k].end, junction),
    );
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
