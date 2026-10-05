import { describe, expect, test } from 'bun:test';
import {
  arcFromChord,
  arcNormalAt,
  arcPointAt,
  arcSagitta,
  arcTangentAt,
  clampSweep,
  sweepFromApex,
  tessellateArc,
  MAX_SWEEP,
} from '../src/geometry/curves/arc.js';
import { distance, point } from '../src/geometry/primitives/point.js';

/**
 * The arc a curved wall runs along, described by the two points it must pass
 * through and how far it turns between them. Endpoints are the fixed input and
 * the centre is derived — a wall has to keep beginning and ending where it did
 * or its junctions come apart.
 */

const A = point(0, 0);
const B = point(1, 0);
const QUARTER = Math.PI / 2;

describe('a straight wall', () => {
  test('has no arc at all', () => {
    // not a circle of enormous radius — nothing, so callers take the straight
    // path rather than dividing by something near zero
    expect(arcFromChord(A, B, 0)).toBeNull();
  });

  test('is still nothing for a sweep too small to see', () => {
    expect(arcFromChord(A, B, 1e-9)).toBeNull();
  });

  test('has no sagitta', () => {
    expect(arcSagitta(1, 0)).toBe(0);
  });
});

describe('the arc through two points', () => {
  test('passes through both of them', () => {
    // the property everything else depends on
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    expect(distance(arcPointAt(arc, 0), A)).toBeCloseTo(0, 9);
    expect(distance(arcPointAt(arc, arc.length), B)).toBeCloseTo(0, 9);
  });

  test('keeps every point at the radius from the centre', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    for (let i = 0; i <= 10; i++) {
      const p = arcPointAt(arc, (arc.length * i) / 10);
      expect(distance(p, arc.center)).toBeCloseTo(arc.radius, 9);
    }
  });

  test('bulges toward +normal for a positive sweep', () => {
    // +normal is perpendicular(b - a) = (0, 1) here, and which side the curve
    // takes has to match the side the wall calls face+
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    expect(arcPointAt(arc, arc.length / 2).y).toBeGreaterThan(0);
  });

  test('bulges the other way for a negative sweep', () => {
    const arc = arcFromChord(A, B, -QUARTER);
    if (!arc) throw new Error('expected an arc');
    expect(arcPointAt(arc, arc.length / 2).y).toBeLessThan(0);
  });

  test('puts its apex exactly a sagitta off the chord', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    expect(arcPointAt(arc, arc.length / 2).y).toBeCloseTo(
      arcSagitta(1, QUARTER),
      9,
    );
  });

  test('is longer than its chord, by the amount the geometry says', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    // R = 0.5/sin(45) and length = R * (pi/2)
    expect(arc.radius).toBeCloseTo(0.5 / Math.sin(QUARTER / 2), 9);
    expect(arc.length).toBeCloseTo(arc.radius * QUARTER, 9);
    expect(arc.length).toBeGreaterThan(1);
  });

  test('is a half circle when it turns half a turn', () => {
    const arc = arcFromChord(A, B, Math.PI);
    if (!arc) throw new Error('expected an arc');
    expect(arc.radius).toBeCloseTo(0.5, 9);
    expect(arc.length).toBeCloseTo(Math.PI * 0.5, 9);
    expect(arc.center.x).toBeCloseTo(0.5, 9);
    expect(arc.center.y).toBeCloseTo(0, 9);
  });
});

describe('travelling along the arc', () => {
  test('the tangent points from start toward end', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    const t = arcTangentAt(arc, 0);
    expect(t.x).toBeGreaterThan(0); // heading toward b
    expect(t.y).toBeGreaterThan(0); // and up over the bulge
  });

  test('the tangent is a unit vector everywhere', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    for (let i = 0; i <= 8; i++) {
      const t = arcTangentAt(arc, (arc.length * i) / 8);
      expect(Math.hypot(t.x, t.y)).toBeCloseTo(1, 9);
    }
  });

  test('the tangent really is the direction the curve moves in', () => {
    // compared against the curve itself rather than re-deriving the formula,
    // so an error in the formula cannot agree with itself
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    const s = arc.length / 3;
    const h = 1e-6;
    const ahead = arcPointAt(arc, s + h);
    const behind = arcPointAt(arc, s - h);
    const measured = {
      x: (ahead.x - behind.x) / (2 * h),
      y: (ahead.y - behind.y) / (2 * h),
    };
    const t = arcTangentAt(arc, s);
    expect(measured.x).toBeCloseTo(t.x, 5);
    expect(measured.y).toBeCloseTo(t.y, 5);
  });

  test('the normal is square to the tangent', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    const t = arcTangentAt(arc, arc.length / 4);
    const n = arcNormalAt(arc, arc.length / 4);
    expect(t.x * n.x + t.y * n.y).toBeCloseTo(0, 9);
  });

  test('the normal at the ends agrees with the straight wall it came from', () => {
    // a wall that stops being curved must not swap which face is which
    const arc = arcFromChord(A, B, 1e-4);
    if (!arc) throw new Error('expected an arc');
    expect(arcNormalAt(arc, 0).y).toBeGreaterThan(0); // +normal is still up
  });
});

describe('dragging the middle of the wall', () => {
  test('gives back the sweep that puts the apex there', () => {
    // the round trip that makes the handle trustworthy: whatever the finger
    // says, the wall must actually pass under it
    for (const sweep of [0.3, 1, 2, -0.5, -2]) {
      const arc = arcFromChord(A, B, sweep);
      if (!arc) throw new Error('expected an arc');
      const apex = arcPointAt(arc, arc.length / 2);
      expect(sweepFromApex(A, B, apex)).toBeCloseTo(sweep, 6);
    }
  });

  test('reads a pull toward +normal as a positive sweep', () => {
    expect(sweepFromApex(A, B, point(0.5, 0.2))).toBeGreaterThan(0);
  });

  test('flips the curve when the finger crosses the chord', () => {
    // rather than jumping or sticking, which is what an unsigned sagitta does
    expect(sweepFromApex(A, B, point(0.5, -0.2))).toBeLessThan(0);
  });

  test('straightens the wall when the finger returns to the chord', () => {
    expect(sweepFromApex(A, B, point(0.5, 0))).toBe(0);
  });

  test('ignores sliding along the wall', () => {
    // a circular arc through two points has its apex at the middle, so the
    // along-chord part of the drag says nothing and must not be invented into
    // a different curve
    const straightOn = sweepFromApex(A, B, point(0.5, 0.2));
    expect(sweepFromApex(A, B, point(0.9, 0.2))).toBeCloseTo(straightOn, 9);
  });
});

describe('what cannot be drawn', () => {
  test('a sweep past a full turn is clamped, not exploded', () => {
    // the chord vanishes at a full turn and the radius runs away; dragging
    // past it has to stop rather than produce infinities
    expect(clampSweep(Math.PI * 4)).toBe(MAX_SWEEP);
    expect(clampSweep(-Math.PI * 4)).toBe(-MAX_SWEEP);
    const arc = arcFromChord(A, B, Math.PI * 4);
    if (!arc) throw new Error('expected an arc');
    expect(Number.isFinite(arc.radius)).toBe(true);
    expect(Number.isFinite(arc.length)).toBe(true);
  });

  test('nothing at all comes back for a zero-length chord', () => {
    expect(arcFromChord(A, A, QUARTER)).toBeNull();
  });

  test('a sweep that is not a number is treated as straight', () => {
    expect(clampSweep(Number.NaN)).toBe(0);
  });
});

describe('tessellating the curve', () => {
  test('starts and ends exactly on the arc', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    const pts = tessellateArc(arc, 0, arc.length);
    expect(distance(pts[0], A)).toBeCloseTo(0, 9);
    expect(distance(pts[pts.length - 1], B)).toBeCloseTo(0, 9);
  });

  test('follows the curvature, not the length', () => {
    // a tight little arc deserves the same smoothness as a long sweeping one
    const tight = arcFromChord(A, point(0.1, 0), QUARTER);
    const wide = arcFromChord(A, point(10, 0), QUARTER);
    if (!tight || !wide) throw new Error('expected arcs');
    expect(tessellateArc(tight, 0, tight.length)).toHaveLength(
      tessellateArc(wide, 0, wide.length).length,
    );
  });

  test('spends more points on a sharper turn', () => {
    const gentle = arcFromChord(A, B, 0.2);
    const sharp = arcFromChord(A, B, Math.PI);
    if (!gentle || !sharp) throw new Error('expected arcs');
    expect(tessellateArc(sharp, 0, sharp.length).length).toBeGreaterThan(
      tessellateArc(gentle, 0, gentle.length).length,
    );
  });

  test('stays within a hair of the true curve', () => {
    // every tessellated point is ON the arc, so the error is the chord sag
    // between them and never a point that has wandered off
    const arc = arcFromChord(A, B, Math.PI);
    if (!arc) throw new Error('expected an arc');
    for (const p of tessellateArc(arc, 0, arc.length)) {
      expect(distance(p, arc.center)).toBeCloseTo(arc.radius, 9);
    }
  });

  test('can tessellate part of the curve', () => {
    const arc = arcFromChord(A, B, QUARTER);
    if (!arc) throw new Error('expected an arc');
    const part = tessellateArc(arc, arc.length / 4, arc.length / 2);
    expect(distance(part[0], arcPointAt(arc, arc.length / 4))).toBeCloseTo(
      0,
      9,
    );
    expect(
      distance(part[part.length - 1], arcPointAt(arc, arc.length / 2)),
    ).toBeCloseTo(0, 9);
  });
});
