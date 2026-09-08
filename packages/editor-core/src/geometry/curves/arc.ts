import type { Point, Vector } from '../primitives/point.js';
import {
  add,
  distance,
  midpoint,
  normalize,
  perpendicular,
  scale,
  sub,
} from '../primitives/point.js';

/**
 * A circular arc described by the two points it must pass through and how far
 * it turns between them.
 *
 * CHORD-AND-SWEEP rather than centre-and-radius, which is the whole reason
 * this file exists. A curved wall still has to begin and end exactly where it
 * did — that is what keeps its junctions, its grips and its neighbours
 * working — so the two endpoints are the fixed input and the centre is
 * derived. Storing the centre instead would let it drift and take the
 * endpoints with it.
 *
 * `sweep` is signed and in radians: positive turns the arc toward the +normal
 * side of the chord (the same +normal a wall calls `face+`), negative toward
 * the other. Zero is a straight line and has no arc at all — every function
 * here returns null for it rather than pretending a circle of infinite radius.
 */
export interface Arc {
  readonly center: Point;
  /** always positive; the sign of the turn lives in `sweep` */
  readonly radius: number;
  /** angle from the centre to the chord start, in radians */
  readonly startAngle: number;
  /** signed, radians; the arc runs start -> end by turning this much */
  readonly sweep: number;
  /** distance along the curve from start to end */
  readonly length: number;
}

/** below this the arc is a straight line and is treated as one */
export const MIN_SWEEP = 1e-6;

/**
 * A sweep this close to a full turn cannot be drawn as an arc between two
 * distinct points: the chord vanishes and the radius runs away to infinity.
 * Clamped rather than rejected so dragging past it stops instead of exploding.
 */
export const MAX_SWEEP = Math.PI * 2 - 1e-3;

/** the arc through `a` and `b` turning by `sweep`, or null when it is straight */
export function arcFromChord(a: Point, b: Point, sweep: number): Arc | null {
  const turn = clampSweep(sweep);
  if (Math.abs(turn) < MIN_SWEEP) return null;
  const chord = distance(a, b);
  if (chord < MIN_SWEEP) return null;

  const half = chord / 2;
  const radius = half / Math.sin(Math.abs(turn) / 2);
  const n = perpendicular(normalize(sub(b, a)));
  /*
   * The centre sits on the perpendicular bisector, on the side AWAY from the
   * bulge — so a positive sweep, which bulges toward +normal, puts the centre
   * on the −normal side. Its distance from the midpoint is the cosine leg of
   * the same half-angle triangle whose sine leg is the half-chord.
   */
  const toCenter = Math.sign(turn) * radius * Math.cos(Math.abs(turn) / 2);
  const center = add(midpoint(a, b), scale(n, -toCenter));

  const startAngle = Math.atan2(a.y - center.y, a.x - center.x);
  return {
    center,
    radius,
    startAngle,
    sweep: turn,
    length: radius * Math.abs(turn),
  };
}

/** keep a sweep inside what can actually be drawn between two points */
export function clampSweep(sweep: number): number {
  if (!Number.isFinite(sweep)) return 0;
  return Math.max(-MAX_SWEEP, Math.min(MAX_SWEEP, sweep));
}

/**
 * The angle at distance `s` along the arc.
 *
 * It SUBTRACTS the sweep, which looks wrong and is not: with the centre placed
 * away from the bulge, travelling start to end runs clockwise in angle for a
 * positive sweep. The check that settles it is the apex — at half the length a
 * positive sweep must land on the +normal side of the chord, and it does.
 */
function angleAt(arc: Arc, s: number): number {
  return arc.startAngle - arc.sweep * (s / arc.length);
}

/** the point at distance `s` along the arc */
export function arcPointAt(arc: Arc, s: number): Point {
  const phi = angleAt(arc, s);
  return {
    x: arc.center.x + arc.radius * Math.cos(phi),
    y: arc.center.y + arc.radius * Math.sin(phi),
  };
}

/** the unit direction of travel at distance `s` along the arc */
export function arcTangentAt(arc: Arc, s: number): Vector {
  const phi = angleAt(arc, s);
  const turn = Math.sign(arc.sweep);
  return { x: turn * Math.sin(phi), y: -turn * Math.cos(phi) };
}

/**
 * The unit normal at distance `s`, on the same side a straight wall calls
 * `face+`.
 *
 * Perpendicular to the local tangent by exactly the rule the straight wall
 * uses, so a wall that stops being curved does not also change which of its
 * faces is which.
 */
export function arcNormalAt(arc: Arc, s: number): Vector {
  return perpendicular(arcTangentAt(arc, s));
}

/**
 * How far the middle of the arc stands off the chord — the sagitta, and the
 * number a person actually sees when they look at a curved wall.
 */
export function arcSagitta(chord: number, sweep: number): number {
  const turn = clampSweep(sweep);
  if (Math.abs(turn) < MIN_SWEEP || chord < MIN_SWEEP) return 0;
  const radius = chord / 2 / Math.sin(Math.abs(turn) / 2);
  return Math.sign(turn) * radius * (1 - Math.cos(Math.abs(turn) / 2));
}

/**
 * The sweep that makes the arc through `a` and `b` pass through `apex`.
 *
 * This is what a finger dragging the middle of a wall is really saying, and it
 * is why the apex is the handle rather than the centre: the centre of a gentle
 * curve is hundreds of meters off screen, while the apex is on the wall, under
 * the finger, and moves the way the wall does.
 *
 * Signed by which side of the chord the apex landed on, so dragging through
 * the chord flips the curve rather than jumping.
 */
export function sweepFromApex(a: Point, b: Point, apex: Point): number {
  const chord = distance(a, b);
  if (chord < MIN_SWEEP) return 0;
  const u = normalize(sub(b, a));
  const n = perpendicular(u);
  const toApex = sub(apex, midpoint(a, b));
  // only the across-chord part bends the wall; sliding along it says nothing,
  // because a circular arc through two points has its apex at the middle
  const sagitta = toApex.x * n.x + toApex.y * n.y;
  if (Math.abs(sagitta) < MIN_SWEEP) return 0;
  // invert sagitta = R(1 - cos(t/2)) with R = (chord/2)/sin(t/2), which
  // collapses to a half-angle whose tangent is sagitta over the half-chord
  return clampSweep(4 * Math.atan2(sagitta, chord / 2));
}

/**
 * The sweep that puts the arc's CENTRE at `center`, keeping both endpoints.
 *
 * A circle through two fixed points cannot have its centre just anywhere: it
 * must sit on the perpendicular bisector of the chord. So only the across-chord
 * part of the drag is read, and the rest is dropped — dragging the centre along
 * the chord asks for a circle that does not exist, and the honest answer is
 * that nothing happens.
 *
 * Which WAY the wall bows is not something the centre can say. Every centre on
 * the bisector carries two arcs through the same two points, one bulging each
 * way — so the bow direction is taken from the wall as it already is, and only
 * the amount of turn comes from the drag. That is also what keeps the wall from
 * flipping inside out as the centre is pulled through the chord: instead the
 * turn grows smoothly past a half circle, which is exactly what pushing the
 * centre toward the wall looks like.
 */
export function sweepFromCenter(
  a: Point,
  b: Point,
  center: Point,
  currentSweep: number,
): number {
  const chord = distance(a, b);
  if (chord < MIN_SWEEP) return 0;
  const n = perpendicular(normalize(sub(b, a)));
  const toCenter = sub(center, midpoint(a, b));
  // the bisector component; everything else is a drag the geometry cannot honour
  const c = toCenter.x * n.x + toCenter.y * n.y;
  const radius = Math.hypot(chord / 2, c);
  if (radius < MIN_SWEEP) return 0;
  /*
   * cos(turn/2) = 1 - sagitta/radius, solved for each of the two arcs. The
   * +normal one has sagitta c + radius, the other radius - c; both reduce to
   * an arccosine of c over the radius, differing only in sign.
   */
  const bowsPositive = currentSweep >= 0;
  const ratio = Math.max(-1, Math.min(1, c / radius));
  return clampSweep(
    bowsPositive ? 2 * Math.acos(-ratio) : -2 * Math.acos(ratio),
  );
}

/**
 * Points along [s0, s1] of the arc, close enough together that the result
 * reads as a curve rather than a fan.
 *
 * `maxAngle` is the most any one straight piece may turn through, so the
 * tessellation follows the CURVATURE rather than the length: a tight little
 * arc gets the same smoothness as a long sweeping one, and a nearly straight
 * wall costs almost nothing. Both ends are always included exactly, so a
 * tessellated span still starts and finishes where it is supposed to.
 */
export function tessellateArc(
  arc: Arc,
  s0: number,
  s1: number,
  maxAngle = Math.PI / 24,
): Point[] {
  const turned = Math.abs(arc.sweep) * (Math.abs(s1 - s0) / arc.length);
  const steps = Math.max(1, Math.ceil(turned / maxAngle));
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    points.push(arcPointAt(arc, s0 + ((s1 - s0) * i) / steps));
  }
  return points;
}
