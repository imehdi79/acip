import type { Point } from '../geometry/primitives/point.js';
import {
  cross,
  distance,
  dot,
  lerp,
  sub,
} from '../geometry/primitives/point.js';
import { closestPointOnSegment } from '../geometry/curves/segment.js';

/**
 * Splitting and de-duplicating a set of segments so that every stretch of the
 * plan is covered exactly once.
 *
 * This is the entity-level counterpart to {@link arrangePlan}, which splits
 * COPIES of the baselines to find rooms. Rooms are derived, so working on
 * copies is right there; walls are documents entities, so when two of them
 * cover the same run the drawing really does hold that wall twice — doubled
 * linework, doubled takeoff, two dimensions on one wall. This module plans the
 * repair; applying it to entities is the WALL.RESOLVE command's job.
 *
 * Pure math over plain segments, entity-free and testable in isolation — the
 * junctions.ts pattern.
 */

export interface OverlapSegment {
  readonly id: string;
  readonly a: Point;
  readonly b: Point;
  /**
   * An obstacle rather than a participant: never cut, never dropped, and it
   * wins any run it shares whatever the input order. Callers flag the runs they
   * are not allowed to rewrite — a wall on a locked layer — so drawing over the
   * existing plan repairs the NEW segment instead of the untouchable one.
   */
  readonly immovable?: boolean;
}

export interface SegmentPiece {
  readonly a: Point;
  readonly b: Point;
}

export interface SegmentPlan {
  readonly id: string;
  /**
   * The pieces this segment keeps, in order along its own a→b. A single piece
   * spanning the whole segment means "leave it alone"; an empty list means
   * every part of it is already covered by an earlier segment.
   */
  readonly keep: SegmentPiece[];
  /** pieces dropped because an earlier segment already covers them */
  readonly dropped: SegmentPiece[];
}

interface Working {
  readonly id: string;
  readonly a: Point;
  readonly b: Point;
  readonly len: number;
  readonly immovable: boolean;
  /** parameters in (0,1) where this segment must be cut */
  readonly splits: number[];
}

/** parameter of `p` projected onto the segment, unclamped */
function paramOf(seg: Working, p: Point): number {
  const ab = sub(seg.b, seg.a);
  return dot(sub(p, seg.a), ab) / dot(ab, ab);
}

/** is `p` on the segment's body (not merely on its infinite line)? */
function onSegment(seg: Working, p: Point, tolerance: number): boolean {
  return distance(p, closestPointOnSegment(p, seg.a, seg.b)) <= tolerance;
}

/** add a cut, ignoring ones that would shave a sliver off either end */
function cut(seg: Working, t: number, tolerance: number): void {
  if (t * seg.len <= tolerance || (1 - t) * seg.len <= tolerance) return;
  seg.splits.push(t);
}

/**
 * Plan the splits and de-duplications for a set of segments.
 *
 * Cuts come from three places, all tolerance-based rather than exact:
 *
 * - **proper crossings** (X) — both segments are cut at the intersection;
 * - **endpoint on a body** (T) — the host is cut where the endpoint lands, so
 *   an endpoint-to-middle connection becomes a real node;
 * - **collinear overlaps** — both are cut at the bounds of the shared run, and
 *   the run itself is then kept only by whichever segment comes FIRST in the
 *   input. Callers pass their stable order (document order), so the older wall
 *   keeps the shared stretch and its id.
 *
 * Endpoint-to-endpoint connections need no cut and produce none.
 *
 * Segments marked `immovable` sit outside all of that: they come back whole,
 * and they claim their stretches before anyone else, so the run they share is
 * always the other segment's to give up.
 */
export function planSegmentOverlaps(
  segments: readonly OverlapSegment[],
  tolerance: number,
): SegmentPlan[] {
  const working: Working[] = [];
  for (const s of segments) {
    const len = distance(s.a, s.b);
    if (len <= tolerance) continue;
    working.push({
      id: s.id,
      a: s.a,
      b: s.b,
      len,
      immovable: s.immovable === true,
      splits: [],
    });
  }

  // immovable segments are cut here like any other: the pieces are what a
  // shared run is matched on below, so both sides must break at the same
  // bounds. Their cuts are dropped again when the plan is emitted.
  for (let i = 0; i < working.length; i++) {
    for (let j = i + 1; j < working.length; j++) {
      const A = working[i];
      const B = working[j];
      const r = sub(A.b, A.a);
      const s = sub(B.b, B.a);
      const denom = cross(r, s);

      // collinear (or as good as): cut both at the shared run's bounds
      if (Math.abs(denom) <= tolerance * Math.max(A.len, B.len)) {
        if (distance(B.a, closestPointOnSegment(B.a, A.a, A.b)) > tolerance) {
          continue; // parallel but apart — nothing shared
        }
        for (const p of [B.a, B.b]) cut(A, paramOf(A, p), tolerance);
        for (const p of [A.a, A.b]) cut(B, paramOf(B, p), tolerance);
        continue;
      }

      // proper crossing, or one segment's endpoint landing on the other's body
      const qp = sub(B.a, A.a);
      const t = cross(qp, s) / denom;
      const u = cross(qp, r) / denom;
      if (
        t >= -tolerance / A.len &&
        t <= 1 + tolerance / A.len &&
        u >= -tolerance / B.len &&
        u <= 1 + tolerance / B.len
      ) {
        cut(A, t, tolerance);
        cut(B, u, tolerance);
      } else if (onSegment(A, B.a, tolerance))
        cut(A, paramOf(A, B.a), tolerance);
      else if (onSegment(A, B.b, tolerance)) cut(A, paramOf(A, B.b), tolerance);
      else if (onSegment(B, A.a, tolerance)) cut(B, paramOf(B, A.a), tolerance);
      else if (onSegment(B, A.b, tolerance)) cut(B, paramOf(B, A.b), tolerance);
    }
  }

  // cut each segment into pieces, then hand out each stretch of the plan to the
  // first segment that claims it
  const pieces = working.map((seg) => piecesOf(seg, tolerance));
  const taken: SegmentPiece[] = [];
  const covers = (piece: SegmentPiece): boolean =>
    taken.some(
      (other) =>
        (distance(other.a, piece.a) <= tolerance &&
          distance(other.b, piece.b) <= tolerance) ||
        (distance(other.a, piece.b) <= tolerance &&
          distance(other.b, piece.a) <= tolerance),
    );

  // immovable segments claim ahead of the rest, so a run they share is lost by
  // the other segment however late they were added; within each group the
  // caller's order still decides, which is what keeps ids stable
  const indices = working.map((_, i) => i);
  const claimOrder = [
    ...indices.filter((i) => working[i].immovable),
    ...indices.filter((i) => !working[i].immovable),
  ];

  const keep: SegmentPiece[][] = working.map(() => []);
  const dropped: SegmentPiece[][] = working.map(() => []);
  for (const i of claimOrder) {
    for (const piece of pieces[i]) {
      if (covers(piece)) dropped[i].push(piece);
      else {
        taken.push(piece);
        keep[i].push(piece);
      }
    }
  }

  return working.map((seg, i) =>
    seg.immovable
      ? // it took part above only to push the others off its run; two immovables
        // sharing a run therefore both come back whole, and neither is cut
        { id: seg.id, keep: [{ a: seg.a, b: seg.b }], dropped: [] }
      : { id: seg.id, keep: keep[i], dropped: dropped[i] },
  );
}

/** the segment broken at its cuts, in order along a→b */
function piecesOf(seg: Working, tolerance: number): SegmentPiece[] {
  const ts = [0];
  for (const t of [...seg.splits].sort((x, y) => x - y)) {
    if ((t - ts[ts.length - 1]) * seg.len > tolerance) ts.push(t);
  }
  ts.push(1);

  const pieces: SegmentPiece[] = [];
  for (let i = 1; i < ts.length; i++) {
    pieces.push({
      a: ts[i - 1] === 0 ? seg.a : lerp(seg.a, seg.b, ts[i - 1]),
      b: ts[i] === 1 ? seg.b : lerp(seg.a, seg.b, ts[i]),
    });
  }
  return pieces;
}

/** does this plan leave the segment exactly as it was? */
export function isUnchanged(plan: SegmentPlan): boolean {
  return plan.keep.length === 1 && plan.dropped.length === 0;
}
