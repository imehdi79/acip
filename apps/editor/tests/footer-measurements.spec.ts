import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import {
  applyMeasurements,
  commonValue,
  prefill,
  selectedWalls,
  wallLength,
  type MeasureView,
} from '@/app/components/layout/footer/measurements';

/**
 * The Measurements dialog's whole decision, without React: which fields are
 * usable, what they dispatch, and what a bad field does to the rest.
 */

let session: EditorSession;

const addWall = (ax: number, ay: number, bx: number, by: number) =>
  session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });

const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;

/** the plan as it has always measured: overall extents, on the only level */
const OUTSIDE: MeasureView = { levelId: null, mode: 'outside' };
const INSIDE: MeasureView = { levelId: null, mode: 'inside' };

const lengthOf = (wall: WallEntity, view: MeasureView = OUTSIDE) =>
  wallLength(session.doc, wall, view);

const edits = (patch: Partial<Record<string, string>> = {}) => ({
  length: '',
  height: '',
  thickness: '',
  ...patch,
});

beforeEach(() => {
  session = new EditorSession();
});

describe('applyMeasurements', () => {
  // centred, not anchored at 'a': a wall in a room has to grow without
  // dragging the whole room sideways — see footer-wall-sync.spec.ts
  it('stretches a single wall about its midpoint', () => {
    const id = addWall(0, 0, 4, 0);
    const wall = wallOf(id);

    expect(
      applyMeasurements(session, [wall], edits({ length: '6' }), OUTSIDE),
    ).toEqual([]);

    expect(wall.getBaseline().a).toEqual(point(-1, 0));
    expect(wall.getBaseline().b).toEqual(point(5, 0));
    expect(lengthOf(wall)).toBeCloseTo(6);
  });

  it('keeps the wall bearing when the length changes', () => {
    const id = addWall(0, 0, 3, 4); // 5 m at 3-4-5
    const wall = wallOf(id);

    applyMeasurements(session, [wall], edits({ length: '10' }), OUTSIDE);

    const { a, b } = wall.getBaseline();
    expect(lengthOf(wall)).toBeCloseTo(10);
    // same 3-4-5 direction, 2.5 m added off each end
    expect(a.x).toBeCloseTo(-1.5);
    expect(a.y).toBeCloseTo(-2);
    expect(b.x).toBeCloseTo(4.5);
    expect(b.y).toBeCloseTo(6);
  });

  it('sets height and thickness across every selected wall', () => {
    const walls = [addWall(0, 0, 4, 0), addWall(0, 4, 4, 4)].map(wallOf);

    applyMeasurements(
      session,
      walls,
      edits({ height: '2.4', thickness: '0.2' }),
      OUTSIDE,
    );

    for (const wall of walls) {
      expect(wall.getHeight()).toBeCloseTo(2.4);
      expect(wall.getThickness()).toBeCloseTo(0.2);
    }
  });

  it('ignores length for a multi-wall selection, applying the rest', () => {
    const walls = [addWall(0, 0, 4, 0), addWall(0, 4, 4, 4)].map(wallOf);

    applyMeasurements(
      session,
      walls,
      edits({ length: '9', height: '2.4' }),
      OUTSIDE,
    );

    for (const wall of walls) {
      expect(lengthOf(wall)).toBeCloseTo(4);
      expect(wall.getHeight()).toBeCloseTo(2.4);
    }
  });

  it('leaves blank fields alone', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    applyMeasurements(session, [wall], edits({ height: '2.4' }), OUTSIDE);

    expect(lengthOf(wall)).toBeCloseTo(4);
    expect(wall.getThickness()).toBeCloseTo(0.3);
  });

  it('applies length and height as one undo', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    applyMeasurements(
      session,
      [wall],
      edits({ length: '6', height: '2.4' }),
      OUTSIDE,
    );
    session.undo();

    expect(lengthOf(wall)).toBeCloseTo(4);
    expect(wall.getHeight()).toBeCloseTo(3);
  });

  it('reports bad fields and changes nothing at all', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    const bad = applyMeasurements(
      session,
      [wall],
      edits({ length: '6', height: 'tall' }),
      OUTSIDE,
    );

    expect(bad).toEqual(['height']);
    // the good field must not land on its own — the dialog stays open
    expect(lengthOf(wall)).toBeCloseTo(4);
  });

  it('treats zero and negative sizes as bad input', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));
    expect(
      applyMeasurements(session, [wall], edits({ length: '0' }), OUTSIDE),
    ).toEqual(['length']);
    expect(
      applyMeasurements(session, [wall], edits({ height: '-2' }), OUTSIDE),
    ).toEqual(['height']);
  });

  it('accepts a unit suffix, overriding the display unit', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    applyMeasurements(session, [wall], edits({ thickness: '200 mm' }), OUTSIDE);

    expect(wall.getThickness()).toBeCloseTo(0.2);
  });
});

/*
 * The dialog's one job is to agree with the drawing. Since the plan gained an
 * inside/outside toggle, "the length of this wall" is no longer a property of
 * the wall — the same wall reads two different numbers — so the dialog has to
 * be reading the same one the user is, and the edit has to land against it.
 */
describe('the dialog measures what the plan measures', () => {
  /** a closed 6x4 room of 0.3 m walls, so every corner is mitered */
  const room = () => {
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    return corners.map((a, i) =>
      wallOf(
        session.dispatch<EntityId>('WALL.ADD', {
          a,
          b: corners[(i + 1) % corners.length],
          thickness: 0.3,
          height: 3,
        }),
      ),
    );
  };

  it('reads the clear width in inside mode and the extent in outside', () => {
    const [bottom] = room();
    // 6 m centreline, mitered both ends: half a thickness past each corner
    // outside, half a thickness short of each corner inside
    expect(lengthOf(bottom, OUTSIDE)).toBeCloseTo(6.3);
    expect(lengthOf(bottom, INSIDE)).toBeCloseTo(5.7);
  });

  it('lands an inside edit on the inside number', () => {
    const [bottom] = room();

    // asking for a 6 m clear width where it read 5.70
    expect(
      applyMeasurements(session, [bottom], edits({ length: '6' }), INSIDE),
    ).toEqual([]);

    expect(lengthOf(bottom, INSIDE)).toBeCloseTo(6);
    // and the drawing's other number moved with it, by the same delta — the
    // wall grew, it did not change what a miter is
    expect(lengthOf(bottom, OUTSIDE)).toBeCloseTo(6.6);
  });

  it('would have applied the same edit somewhere else in outside mode', () => {
    // the regression this whole seam exists for: before the view was carried,
    // the dialog subtracted an OUTSIDE extent from an INSIDE figure, so a
    // no-op edit moved the wall by a thickness
    const [bottom] = room();
    const clear = lengthOf(bottom, INSIDE);

    applyMeasurements(
      session,
      [bottom],
      edits({ length: clear.toFixed(2) }),
      INSIDE,
    );

    // asking for the number already on the screen must change nothing
    expect(lengthOf(bottom, INSIDE)).toBeCloseTo(clear);
  });

  it('measures an unjoined wall the same either way', () => {
    // butt caps square off both faces at one place, so there is no inner face
    // to be shorter — the toggle is about corners, and this wall has none
    const wall = wallOf(addWall(0, 0, 4, 0));
    expect(lengthOf(wall, INSIDE)).toBeCloseTo(lengthOf(wall, OUTSIDE));
  });
});

describe('prefilling the dialog', () => {
  it('shows a shared value and blanks a mixed one', () => {
    const walls = [addWall(0, 0, 4, 0), addWall(0, 4, 4, 4)].map(wallOf);
    expect(prefill(commonValue(walls, (w) => w.getHeight()))).toBe('3.00');

    applyMeasurements(session, [walls[0]], edits({ height: '2.4' }));
    expect(commonValue(walls, (w) => w.getHeight())).toBeNull();
    expect(prefill(null)).toBe('');
  });

  it('collects only walls from the selection', () => {
    const wall = addWall(0, 0, 4, 0);
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: wall,
      t: 0.5,
      width: 1,
    });
    session.selection.add(wall);
    session.selection.add(window);

    expect(selectedWalls(session).map((w) => w.id)).toEqual([wall]);
  });
});
