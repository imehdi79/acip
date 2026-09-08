import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { moveWallStartTo, wallBearing } from '@/editor/rooms';
import { setLengthUnit } from '@/editor/units';
import {
  applyMeasurements,
  startPrefill,
  type JogEdits,
  type MeasureView,
  type StartEdit,
} from '@/app/components/layout/footer/measurements';

/**
 * Placing a wall entirely by number: where it begins, how long it is, which
 * way it runs. The last piece of tracing a surveyed plan — length and angle
 * put the far end exactly once the near one is right, and this is what makes
 * the near one right.
 */

let session: EditorSession;
const CENTRE: MeasureView = { levelId: null, mode: 'center' };

const addWall = (a: Point, b: Point, t = 0.3) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: t });
const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;
const startOf = (id: EntityId) => wallOf(id).getBaseline().a;
const endOf = (id: EntityId) => wallOf(id).getBaseline().b;

const noJogs: JogEdits = {
  start: { on: false, size: '' },
  end: { on: false, size: '' },
};
const nowhere: StartEdit = { x: '', y: '' };

const apply = (
  id: EntityId,
  opts: {
    start?: StartEdit;
    length?: string;
    angle?: string;
    spread?: 'push' | 'absorb' | 'alone';
  } = {},
) =>
  applyMeasurements(
    session,
    [wallOf(id)],
    { length: opts.length ?? '', height: '', thickness: '' },
    CENTRE,
    opts.spread ?? 'push',
    noJogs,
    '',
    opts.angle ?? '',
    opts.start ?? nowhere,
  );

beforeEach(() => {
  session = new EditorSession();
  setLengthUnit('m');
});

describe('typing where a wall begins', () => {
  it('puts the start corner exactly there', () => {
    const id = addWall(point(1.234, 5.678), point(5.234, 5.678));
    expect(apply(id, { start: { x: '2', y: '3' } })).toEqual([]);
    expect(startOf(id).x).toBeCloseTo(2, 9);
    expect(startOf(id).y).toBeCloseTo(3, 9);
  });

  it('carries the whole wall, keeping its length and bearing', () => {
    // a translation, not a stretch — that is what lets the three numbers
    // compose instead of undoing each other
    const id = addWall(point(0, 0), point(3, 4)); // 5 long, 53.13 degrees
    const bearing = wallBearing(wallOf(id));
    apply(id, { start: { x: '10', y: '10' } });
    expect(wallOf(id).getLength()).toBeCloseTo(5, 9);
    expect(wallBearing(wallOf(id))).toBeCloseTo(bearing, 9);
    expect(endOf(id).x).toBeCloseTo(13, 9);
    expect(endOf(id).y).toBeCloseTo(14, 9);
  });

  it('accepts the origin, which is a real place for a corner', () => {
    // unlike every length here, zero is an answer
    const id = addWall(point(4, 4), point(8, 4));
    expect(apply(id, { start: { x: '0', y: '0' } })).toEqual([]);
    expect(startOf(id)).toEqual({ x: 0, y: 0 });
  });

  it('accepts a negative coordinate', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(apply(id, { start: { x: '-2.5', y: '-1' } })).toEqual([]);
    expect(startOf(id).x).toBeCloseTo(-2.5, 9);
    expect(startOf(id).y).toBeCloseTo(-1, 9);
  });

  it('moves on one axis when only one is filled in', () => {
    const id = addWall(point(1, 7), point(5, 7));
    apply(id, { start: { x: '3', y: '' } });
    expect(startOf(id).x).toBeCloseTo(3, 9);
    expect(startOf(id).y).toBeCloseTo(7, 9); // untouched
  });

  it('reads back what it was given', () => {
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { start: { x: '2.35', y: '6.1' } });
    const shown = startPrefill(wallOf(id));
    expect(Number(shown.x)).toBeCloseTo(2.35, 2);
    expect(Number(shown.y)).toBeCloseTo(6.1, 2);
  });
});

describe('in centimetres, which is how the plan is dimensioned', () => {
  it('reads a typed coordinate in the active unit', () => {
    setLengthUnit('cm');
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { start: { x: '259', y: '316' } });
    expect(startOf(id).x).toBeCloseTo(2.59, 9);
    expect(startOf(id).y).toBeCloseTo(3.16, 9);
  });

  it('shows the corner back in that unit', () => {
    setLengthUnit('cm');
    const id = addWall(point(2.59, 3.16), point(6, 3.16));
    expect(Number(startPrefill(wallOf(id)).x)).toBeCloseTo(259, 1);
  });

  it('takes an explicit unit that overrides the active one', () => {
    setLengthUnit('m');
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { start: { x: '547 cm', y: '0' } });
    expect(startOf(id).x).toBeCloseTo(5.47, 9);
  });
});

describe('a coordinate it cannot read', () => {
  it('is reported on the axis it was typed on', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(apply(id, { start: { x: '2', y: 'abc' } })).toEqual(['startY']);
  });

  it('moves the wall nowhere at all', () => {
    // a good x and a broken y would put the wall somewhere nobody asked for,
    // on an axis they were not editing
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { start: { x: '9', y: 'abc' } });
    expect(startOf(id)).toEqual({ x: 0, y: 0 });
  });

  it('holds back the other edits in the same Apply', () => {
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { start: { x: 'abc', y: '0' }, length: '6', angle: '30' });
    expect(wallOf(id).getLength()).toBeCloseTo(4, 9);
    expect(wallBearing(wallOf(id))).toBeCloseTo(0, 9);
  });
});

describe('all three numbers together', () => {
  it('place the wall exactly, corner to corner', () => {
    /*
     * The whole point. A surveyed wall is a place, a size and a direction, and
     * none of the three can be dragged accurately on a phone. Given all three,
     * both ends have to land on the millimetre.
     */
    const id = addWall(point(1, 1), point(2, 2));
    expect(
      apply(id, {
        start: { x: '2.59', y: '3.16' },
        length: '5.47',
        angle: '23',
      }),
    ).toEqual([]);
    const rad = (23 * Math.PI) / 180;
    expect(startOf(id).x).toBeCloseTo(2.59, 9);
    expect(startOf(id).y).toBeCloseTo(3.16, 9);
    expect(endOf(id).x).toBeCloseTo(2.59 + 5.47 * Math.cos(rad), 9);
    expect(endOf(id).y).toBeCloseTo(3.16 + 5.47 * Math.sin(rad), 9);
  });

  it('apply in an order where none undoes another', () => {
    // length sizes it, angle aims it, position carries it — and only a
    // translation last can honour the two before it
    const id = addWall(point(0, 0), point(1, 0));
    apply(id, { start: { x: '10', y: '10' }, length: '4', angle: '90' });
    expect(wallOf(id).getLength()).toBeCloseTo(4, 9);
    expect(wallBearing(wallOf(id))).toBeCloseTo(90, 9);
    expect(startOf(id).x).toBeCloseTo(10, 9);
    expect(startOf(id).y).toBeCloseTo(10, 9);
  });

  it('are one undo, because they were one Apply', () => {
    const id = addWall(point(0, 0), point(1, 0));
    apply(id, { start: { x: '10', y: '10' }, length: '4', angle: '90' });
    session.history.undo();
    expect(startOf(id)).toEqual({ x: 0, y: 0 });
    expect(endOf(id)).toEqual({ x: 1, y: 0 });
  });
});

describe('what the neighbours do', () => {
  it('stretch to stay welded when the wall is linked', () => {
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(0, 0), point(0, 3));
    moveWallStartTo(
      (n, p) => session.dispatch(n, p),
      session.doc,
      a,
      point(1, 1),
      'push',
    );
    // b's shared corner followed; its far end stayed put
    expect(wallOf(b).getBaseline().a.x).toBeCloseTo(1, 9);
    expect(wallOf(b).getBaseline().b).toEqual({ x: 0, y: 3 });
  });

  it('stay exactly where they are when it is moved alone', () => {
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(0, 0), point(0, 3));
    moveWallStartTo(
      (n, p) => session.dispatch(n, p),
      session.doc,
      a,
      point(1, 1),
      'alone',
    );
    expect(wallOf(b).getBaseline().a).toEqual({ x: 0, y: 0 });
    expect(startOf(a)).toEqual({ x: 1, y: 1 });
  });

  it('cost no undo step when the corner does not actually move', () => {
    /*
     * Re-applying a dialog opened to fix a height must not spend an undo on a
     * move of nothing. Proved by undoing ONCE: if the no-op had recorded a
     * step, that undo would spend itself on it and the wall would still be
     * there.
     */
    const a = addWall(point(0, 0), point(4, 0));
    moveWallStartTo(
      (n, p) => session.dispatch(n, p),
      session.doc,
      a,
      point(0, 0),
      'push',
    );
    session.history.undo();
    expect(session.doc.get(a) ?? null).toBeNull();
  });
});

describe('several walls at once', () => {
  it('keep their positions, since a place is not shared', () => {
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(0, 2), point(4, 2));
    applyMeasurements(
      session,
      [wallOf(a), wallOf(b)],
      { length: '', height: '3', thickness: '' },
      CENTRE,
      'push',
      noJogs,
      '',
      '',
      { x: '9', y: '9' },
    );
    expect(startOf(a)).toEqual({ x: 0, y: 0 });
    expect(startOf(b)).toEqual({ x: 0, y: 2 });
    expect(wallOf(a).getHeight()).toBeCloseTo(3, 9);
  });
});
