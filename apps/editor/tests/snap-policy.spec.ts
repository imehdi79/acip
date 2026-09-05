import { describe, expect, it } from 'vitest';
import type { Point, SnapKind, SnapPoint } from '@acip/editor-core';
import {
  CORNER_KINDS,
  TOUCH_DRAG_PX,
  TOUCH_GRAB_PX,
  magneticSnap,
  touchSnapOptions,
  type Snapper,
} from '@/editor/snap-policy';

/**
 * A stand-in engine that answers the way the real one does — closest
 * candidate within tolerance, honouring a kind filter — so the ladder can be
 * checked without a document.
 */
function engineOf(points: readonly SnapPoint[]): Snapper & { asked: number[] } {
  const asked: number[] = [];
  return {
    asked,
    snap(cursor: Point, tolerance: number, filter?: readonly SnapKind[]) {
      asked.push(tolerance);
      let best: SnapPoint | null = null;
      let bestDist = Infinity;
      for (const p of points) {
        if (filter && !filter.includes(p.kind)) continue;
        const d = Math.hypot(cursor.x - p.point.x, cursor.y - p.point.y);
        if (d <= tolerance && d < bestDist) {
          best = p;
          bestDist = d;
        }
      }
      return best;
    },
  };
}

const opts = (over: Partial<Parameters<typeof magneticSnap>[2]> = {}) => ({
  scale: 100, // 100 px per metre, so 1 px = 1 cm
  radiusPx: 12,
  cornerPullPx: 28,
  origin: null,
  originPullPx: 14,
  ...over,
});

describe('what a finger is reaching for', () => {
  it('takes a corner over a nearer point on an edge', () => {
    /*
     * The reason the policy exists. The engine picks the CLOSEST candidate,
     * and an edge's `nearest` point is by definition never further than the
     * corner ending that edge — so on plain proximity a corner only ever wins
     * when the finger is already exactly on it, which on a phone it is not.
     */
    const engine = engineOf([
      { kind: 'nearest', point: { x: 0.02, y: 0 } },
      { kind: 'endpoint', point: { x: 0.15, y: 0 } },
    ]);
    const hit = magneticSnap(engine, { x: 0, y: 0 }, opts());
    expect(hit?.kind).toBe('endpoint');
  });

  it('still takes an edge when no corner is within reach', () => {
    // magnetism, not tunnel vision
    const engine = engineOf([
      { kind: 'nearest', point: { x: 0.02, y: 0 } },
      { kind: 'endpoint', point: { x: 5, y: 0 } },
    ]);
    expect(magneticSnap(engine, { x: 0, y: 0 }, opts())?.kind).toBe('nearest');
  });

  it('asks for corners from further away than anything else', () => {
    const engine = engineOf([]);
    magneticSnap(engine, { x: 0, y: 0 }, opts());
    const [cornerReach, ordinaryReach] = engine.asked;
    expect(cornerReach).toBeGreaterThan(ordinaryReach);
  });

  it('counts only the kinds walls actually meet at as corners', () => {
    // `nearest` is the one that must never be in here, or the wider reach
    // would apply to every point along every edge and nothing would be magnetic
    expect(CORNER_KINDS).not.toContain('nearest');
    expect(CORNER_KINDS).toContain('endpoint');
  });
});

describe('putting a thing back where it came from', () => {
  const origin = { x: 2, y: 3 };

  it('snaps home when the finger returns to the start', () => {
    // with plain proximity, "back where it was" lands a few millimetres off
    // and quietly moves the wall by that much
    const engine = engineOf([{ kind: 'endpoint', point: { x: 2.05, y: 3 } }]);
    const hit = magneticSnap(
      engine,
      { x: 2.01, y: 3 },
      opts({ origin, originPullPx: 14 }),
    );
    expect(hit?.point).toEqual(origin);
  });

  it('beats a corner sitting right next to the start', () => {
    // a user coming back to where they picked something up is not aiming at
    // whatever else happens to be nearby
    const engine = engineOf([{ kind: 'endpoint', point: { x: 2, y: 3.01 } }]);
    expect(
      magneticSnap(engine, { x: 2.005, y: 3 }, opts({ origin }))?.point,
    ).toEqual(origin);
  });

  it('lets go once the finger is properly away', () => {
    const engine = engineOf([]);
    expect(magneticSnap(engine, { x: 4, y: 3 }, opts({ origin }))).toBeNull();
  });

  it('has no home to return to when nothing is being dragged', () => {
    const engine = engineOf([]);
    expect(
      magneticSnap(engine, { x: 2, y: 3 }, opts({ origin: null })),
    ).toBeNull();
  });
});

describe('how wide the net is', () => {
  it('is wider for grabbing than for placing', () => {
    /*
     * Grabbing wants a wide net: missing the grip costs a whole gesture.
     * Placing wants a narrow one: the thing is in hand and the finger is
     * steering it, and a wide net drags it onto everything it sails past.
     */
    expect(touchSnapOptions(60, false, null).radiusPx).toBe(TOUCH_GRAB_PX);
    expect(touchSnapOptions(60, true, null).radiusPx).toBe(TOUCH_DRAG_PX);
    expect(TOUCH_DRAG_PX).toBeLessThan(TOUCH_GRAB_PX);
  });

  it('keeps corners magnetic even while placing', () => {
    // the net narrows, but corners are still what a drag is aiming at
    const dragging = touchSnapOptions(60, true, null);
    expect(dragging.cornerPullPx).toBeGreaterThan(dragging.radiusPx);
  });

  it('only offers home while something is actually in hand', () => {
    const origin = { x: 1, y: 1 };
    expect(touchSnapOptions(60, false, origin).origin).toBeNull();
    expect(touchSnapOptions(60, true, origin).origin).toEqual(origin);
  });

  it('turns a screen radius into a world one through the zoom', () => {
    // zoomed in, the same 12 px is a much smaller distance on the plan —
    // otherwise magnetism would get coarser the closer you looked
    const engine = engineOf([]);
    magneticSnap(engine, { x: 0, y: 0 }, opts({ scale: 200 }));
    const zoomed = [...engine.asked];
    engine.asked.length = 0;
    magneticSnap(engine, { x: 0, y: 0 }, opts({ scale: 50 }));
    expect(zoomed[0]).toBeLessThan(engine.asked[0]);
  });
});
