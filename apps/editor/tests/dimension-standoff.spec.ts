import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import { dimensionStandoff } from '@/editor/viewport/scene-renderer';
import { planDimensions } from '@/editor/viewport/wall-dimensions';

/**
 * Where a dimension line SITS.
 *
 * Its measurement anchors are on the wall's axis, so the stand-off has to
 * clear half a wall on its way out. A flat pixel stand-off does not: it walks
 * into the wall the moment the plan is zoomed in far enough, which is how a
 * whole plan came back with every dimension drawn inside its own walls.
 */

let session: EditorSession;
const PLAN: ViewDefinition = { kind: 'plan', levelId: null };

const addWall = (a: Point, b: Point, thickness = 0.3) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness });

const room = (x0: number, y0: number, x1: number, y1: number, t = 0.3) => {
  const c = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return c.map((a, i) => addWall(a, c[(i + 1) % c.length], t));
};

/** half a 0.30 m wall, in screen pixels, at this many pixels per meter */
const halfPx = (scale: number, thickness = 0.3) => (thickness / 2) * scale;

beforeEach(() => {
  session = new EditorSession();
});

describe('clearing the wall', () => {
  it('stands off further than half the wall at every zoom', () => {
    // the bug, stated as the property that was violated: at 200 px/m a 0.30 m
    // wall is 30 px across its axis, and the old flat 18 px put the line 12 px
    // INSIDE the wall it was measuring
    for (const scale of [20, 60, 120, 200, 400, 1000]) {
      expect(dimensionStandoff(halfPx(scale), 0)).toBeGreaterThan(
        halfPx(scale),
      );
    }
  });

  it('leaves the same visible gap however far it is zoomed', () => {
    // the clearance is measured from the FACE, so what stays constant on
    // screen is the gap beyond it — that is what makes it look right at 1:50
    // and at 1:5 alike
    const gap = (scale: number) =>
      dimensionStandoff(halfPx(scale), 0) - halfPx(scale);
    expect(gap(60)).toBeCloseTo(gap(600), 9);
  });

  it('clears a thick wall by as much as a thin one', () => {
    const scale = 200;
    const thin = dimensionStandoff(halfPx(scale, 0.1), 0) - halfPx(scale, 0.1);
    const thick = dimensionStandoff(halfPx(scale, 0.5), 0) - halfPx(scale, 0.5);
    expect(thin).toBeCloseTo(thick, 9);
  });

  it('still separates the lanes beyond that', () => {
    const scale = 200;
    const first = dimensionStandoff(halfPx(scale), 0);
    const second = dimensionStandoff(halfPx(scale), 1);
    expect(second).toBeGreaterThan(first);
  });

  it('treats a wall of no thickness as the plain gap it always was', () => {
    expect(dimensionStandoff(0, 0)).toBe(18);
  });

  it('does not let a nonsense width pull the line back into the wall', () => {
    expect(dimensionStandoff(-50, 0)).toBe(18);
  });
});

describe('what the dimension carries', () => {
  it('every wall reports the half-thickness the line has to clear', () => {
    // without this the renderer has nothing to clear BY, which is what the
    // flat stand-off amounted to
    room(0, 0, 4, 3, 0.3);
    const dims = planDimensions(session.doc, PLAN);
    expect(dims.length).toBeGreaterThan(0);
    for (const dim of dims) expect(dim.halfWidth).toBeCloseTo(0.15, 9);
  });

  it('reports a thick wall as thick', () => {
    room(0, 0, 4, 3, 0.5);
    for (const dim of planDimensions(session.doc, PLAN)) {
      expect(dim.halfWidth).toBeCloseTo(0.25, 9);
    }
  });

  it('gives an opening the wall it is cut into, not its own width', () => {
    // an opening is quoted from the same axis, so it has the same wall to clear
    const wall = addWall(point(0, 0), point(6, 0), 0.4);
    session.dispatch('WINDOW.ADD', { wallId: wall, t: 0.5, width: 1 });
    const opening = planDimensions(session.doc, PLAN).find(
      (d) => d.kind === 'opening',
    );
    expect(opening?.halfWidth).toBeCloseTo(0.2, 9);
  });

  it('survives the layout pass that assigns lanes', () => {
    // the value is read in the renderer, which sees the LAID OUT dimension —
    // a field dropped on the way through would leave the bug exactly as it was
    room(0, 0, 4, 3, 0.3);
    room(0, 5, 4, 8, 0.3);
    for (const dim of planDimensions(session.doc, PLAN)) {
      expect(dim.halfWidth).toBeGreaterThan(0);
    }
  });
});

describe('the numbers themselves', () => {
  it('reads the same on facing walls of a rectangle', () => {
    // what a rectangle has to look like: opposite sides agree
    const [bottom, right, top, left] = room(0, 0, 4, 3);
    const len = (id: EntityId) =>
      planDimensions(session.doc, PLAN).find((d) => d.entityId === id)?.length;
    expect(len(bottom)).toBeCloseTo(len(top) as number, 9);
    expect(len(left)).toBeCloseTo(len(right) as number, 9);
  });

  it('reads outer corner to outer corner in outside mode', () => {
    const [bottom] = room(0, 0, 4, 3);
    const dim = planDimensions(session.doc, PLAN, new Set(), 'outside').find(
      (d) => d.entityId === bottom,
    );
    expect(dim?.length).toBeCloseTo(4.3, 9); // 4.00 plus a miter each end
  });

  it('reads the clear width in inside mode', () => {
    const [bottom] = room(0, 0, 4, 3);
    const dim = planDimensions(session.doc, PLAN, new Set(), 'inside').find(
      (d) => d.entityId === bottom,
    );
    expect(dim?.length).toBeCloseTo(3.7, 9); // 4.00 less a half wall each end
  });
});
