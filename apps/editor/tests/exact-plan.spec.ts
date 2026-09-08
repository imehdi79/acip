import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  point,
} from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import { SQUARE_TOL, STEP_TOL, constrainAngle } from '@/editor/tools/drafting';
import { planWallRotate, rotateWallTo, wallBearing } from '@/editor/rooms';
import {
  anglePrefill,
  applyMeasurements,
  type JogEdits,
  type MeasureView,
} from '@/app/components/layout/footer/measurements';
import { planDimensions } from '@/editor/viewport/wall-dimensions';

/**
 * Reproducing a SURVEYED plan, which is a different job from sketching one.
 * The numbers are given to the centimetre and the walls run at whatever angles
 * the building runs at — so both the length and the direction have to be
 * typeable, and the drawing aids have to get out of the way.
 */

let session: EditorSession;
const PLAN: ViewDefinition = { kind: 'plan', levelId: null };
const VIEW: MeasureView = { levelId: null, mode: 'outside' };

const addWall = (a: Point, b: Point, t = 0.3) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: t });
const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;

const noJogs: JogEdits = {
  start: { on: false, size: '' },
  end: { on: false, size: '' },
};

const applyAngle = (id: EntityId, angle: string, length = '') =>
  applyMeasurements(
    session,
    [wallOf(id)],
    { length, height: '', thickness: '' },
    VIEW,
    'push',
    noJogs,
    '',
    angle,
  );

const bearingOf = (from: Point, to: Point) =>
  ((Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI + 360) % 360;

beforeEach(() => {
  session = new EditorSession();
});

describe('drawing at an angle the building actually has', () => {
  it('leaves an odd bearing exactly as drawn', () => {
    /*
     * The bug this exists for. The magnet was +/-6 degrees around every 15,
     * which captured 12 of every 15 — four fifths of every bearing a finger
     * could ask for was rewritten, and a plan of 23 and 67 degree walls could
     * not be drawn at all.
     */
    for (const deg of [23, 67, 41, 12, 78]) {
      const rad = (deg * Math.PI) / 180;
      const to = point(Math.cos(rad), Math.sin(rad));
      const r = constrainAngle(point(0, 0), to, false);
      expect(r.locked).toBe(false);
      expect(r.deg).toBeCloseTo(deg, 6);
    }
  });

  it('still pulls a nearly square wall square', () => {
    // square is what most walls are, and two degrees off it is a slip
    const rad = (2 * Math.PI) / 180;
    const r = constrainAngle(
      point(0, 0),
      point(Math.cos(rad), Math.sin(rad)),
      false,
    );
    expect(r.locked).toBe(true);
    expect(r.deg).toBeCloseTo(0, 6);
  });

  it('holds square more widely than it holds the marks between', () => {
    // the asymmetry IS the fix: help where walls really are square, without
    // rewriting the angles on a plan that is not
    expect(SQUARE_TOL).toBeGreaterThan(STEP_TOL);
  });

  it('lets a bearing three degrees off a 15 mark stand', () => {
    const rad = (18 * Math.PI) / 180; // 3 past the 15 mark
    const r = constrainAngle(
      point(0, 0),
      point(Math.cos(rad), Math.sin(rad)),
      false,
    );
    expect(r.locked).toBe(false);
  });

  it('keeps the distance to the cursor when it does snap', () => {
    const r = constrainAngle(point(0, 0), point(5, 0.1), false);
    expect(Math.hypot(r.point.x, r.point.y)).toBeCloseTo(Math.hypot(5, 0.1), 9);
  });
});

describe('typing an exact bearing', () => {
  it('turns the wall to it', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(applyAngle(id, '23')).toEqual([]);
    expect(wallBearing(wallOf(id))).toBeCloseTo(23, 6);
  });

  it('keeps the wall the length it was', () => {
    // a bearing says which way, not how far
    const id = addWall(point(0, 0), point(4, 0));
    applyAngle(id, '23');
    expect(wallOf(id).getLength()).toBeCloseTo(4, 6);
  });

  it('holds the joined end still and swings the free one', () => {
    const a = addWall(point(0, 0), point(4, 0));
    addWall(point(0, 0), point(0, 3)); // joined at the start
    applyAngle(a, '30');
    expect(wallOf(a).getBaseline().a).toEqual({ x: 0, y: 0 });
  });

  it('reads back the bearing it was given', () => {
    const id = addWall(point(0, 0), point(4, 0));
    applyAngle(id, '67.25');
    expect(Number(anglePrefill(wallOf(id)))).toBeCloseTo(67.25, 2);
  });

  it('always reports start to end, whichever end is held', () => {
    // the same wall must not read 23 or 203 depending on a join it did not
    // ask for — a survey quotes one of those, not either
    const a = addWall(point(0, 0), point(4, 0));
    addWall(point(4, 0), point(4, 3)); // joined at the END this time
    applyAngle(a, '150');
    expect(wallBearing(wallOf(a))).toBeCloseTo(150, 6);
  });

  it('sets a length and a bearing together, about the same corner', () => {
    /*
     * The two halves of placing a wall exactly. In CENTRE mode the typed 6.00
     * is the centreline, so the far end lands exactly 6.00 away on the exact
     * bearing — which is how a survey quotes it.
     *
     * In outside mode the same 6.00 means the drawn extent, so the centreline
     * comes out at 5.85 with a mitered corner eating the difference. Both are
     * right; only one of them is what a plan dimensioned to the centimetre is
     * asking for, and that is the reason centre mode exists.
     */
    const id = addWall(point(0, 0), point(4, 0));
    addWall(point(0, 0), point(0, 3));
    const centred: MeasureView = { levelId: null, mode: 'center' };
    expect(
      applyMeasurements(
        session,
        [wallOf(id)],
        { length: '6', height: '', thickness: '' },
        centred,
        'push',
        noJogs,
        '',
        '30',
      ),
    ).toEqual([]);
    const { a, b } = wallOf(id).getBaseline();
    expect(a).toEqual({ x: 0, y: 0 });
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeCloseTo(6, 6);
    expect(bearingOf(a, b)).toBeCloseTo(30, 6);
  });

  it('reports a bearing it cannot read instead of guessing', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(applyAngle(id, 'abc')).toEqual(['angle']);
    expect(wallBearing(wallOf(id))).toBeCloseTo(0, 6);
  });

  it('leaves the wall alone when the box is blank', () => {
    const id = addWall(point(0, 0), point(4, 0));
    applyMeasurements(
      session,
      [wallOf(id)],
      { length: '', height: '3', thickness: '' },
      VIEW,
      'push',
      noJogs,
      '',
      '',
    );
    expect(wallBearing(wallOf(id))).toBeCloseTo(0, 6);
  });

  it('takes the welded corner with it, so a room stays shut', () => {
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(4, 0), point(4, 3));
    rotateWallTo((n, p) => session.dispatch(n, p), session.doc, a, 20, 'push');
    const end = wallOf(a).getBaseline().b;
    expect(wallOf(b).getBaseline().a.x).toBeCloseTo(end.x, 6);
    expect(wallOf(b).getBaseline().a.y).toBeCloseTo(end.y, 6);
  });

  it('turns this wall only when told to', () => {
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(4, 0), point(4, 3));
    rotateWallTo((n, p) => session.dispatch(n, p), session.doc, a, 20, 'alone');
    expect(wallOf(b).getBaseline().a).toEqual({ x: 4, y: 0 });
  });

  it('turns a free wall about its own middle, so it stays put', () => {
    const id = addWall(point(0, 0), point(4, 0));
    const plan = planWallRotate(session.doc, id, 90, 'push');
    expect(plan?.moves).toHaveLength(2);
    rotateWallTo((n, p) => session.dispatch(n, p), session.doc, id, 90);
    const { a, b } = wallOf(id).getBaseline();
    expect((a.x + b.x) / 2).toBeCloseTo(2, 6);
    expect((a.y + b.y) / 2).toBeCloseTo(0, 6);
  });
});

describe('which reference a dimension is quoted from', () => {
  const room = () => {
    const c = [point(0, 0), point(4, 0), point(4, 3), point(0, 3)];
    return c.map((a, i) => addWall(a, c[(i + 1) % c.length]));
  };
  const lengthOf = (id: EntityId, mode: MeasureView['mode']) =>
    planDimensions(session.doc, PLAN, new Set(), mode).find(
      (d) => d.entityId === id,
    )?.length;

  it('reads the centreline in centre mode', () => {
    // what a survey quotes: 4.00 is 4.00, whatever the corners do
    const [bottom] = room();
    expect(lengthOf(bottom, 'center')).toBeCloseTo(4, 9);
  });

  it('sits between the outer and the clear reading', () => {
    const [bottom] = room();
    expect(lengthOf(bottom, 'inside')).toBeLessThan(
      lengthOf(bottom, 'center') as number,
    );
    expect(lengthOf(bottom, 'center')).toBeLessThan(
      lengthOf(bottom, 'outside') as number,
    );
  });

  it('does not move when the wall is made thicker', () => {
    // the property that makes it the right reference for a survey
    const [bottom] = room();
    const before = lengthOf(bottom, 'center');
    session.dispatch('WALL.SETPROPS', { ids: [bottom], thickness: 0.6 });
    expect(lengthOf(bottom, 'center')).toBeCloseTo(before as number, 9);
  });

  it('does move the other two, which is why they are not it', () => {
    /*
     * Thickening the NEIGHBOURS, not this wall. A wall's own thickness widens
     * it; what lengthens its drawn extent is the miters at its ends, and those
     * are cut against the walls it meets. So an outside dimension moves when a
     * wall you did not touch is made thicker — which is exactly the trap a
     * survey needs to avoid, and exactly what centre mode is immune to.
     */
    const [bottom, right, , left] = room();
    const outsideBefore = lengthOf(bottom, 'outside');
    const centreBefore = lengthOf(bottom, 'center');
    session.dispatch('WALL.SETPROPS', { ids: [right, left], thickness: 0.6 });
    expect(lengthOf(bottom, 'outside')).not.toBeCloseTo(
      outsideBefore as number,
      6,
    );
    expect(lengthOf(bottom, 'center')).toBeCloseTo(centreBefore as number, 9);
  });
});

describe('a curved wall closing a room', () => {
  it('joins straight walls at BOTH ends', () => {
    // the facade case: two straight runs and an arc between them
    const left = addWall(point(0, 0), point(0, 3));
    const arc = addWall(point(0, 3), point(4, 3));
    const right = addWall(point(4, 3), point(4, 0));
    const bottom = addWall(point(4, 0), point(0, 0));
    session.dispatch('WALL.SETARC', { ids: [arc], sweep: 0.9 });
    expect(wallOf(arc).getJoinsAt('start')).toHaveLength(1);
    expect(wallOf(arc).getJoinsAt('end')).toHaveLength(1);
    expect(wallOf(left).getJoinsAt('end')).toHaveLength(1);
    expect(wallOf(right).getJoinsAt('start')).toHaveLength(1);
    expect(wallOf(bottom).getLength()).toBeCloseTo(4, 6);
  });

  it('still encloses one room', () => {
    const c = [point(0, 0), point(4, 0), point(4, 3), point(0, 3)];
    const ids = c.map((a, i) => addWall(a, c[(i + 1) % c.length]));
    session.dispatch('WALL.SETARC', { ids: [ids[2]], sweep: -0.9 });
    expect(detectSpaces(session.doc, null)).toHaveLength(1);
  });

  it('can be turned to an exact bearing like any other wall', () => {
    // the chord is what a bearing means on a curve, and it is still a wall
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETARC', { ids: [id], sweep: 0.6 });
    applyAngle(id, '35');
    expect(wallBearing(wallOf(id))).toBeCloseTo(35, 6);
    expect(wallOf(id).isCurved()).toBe(true);
  });
});
