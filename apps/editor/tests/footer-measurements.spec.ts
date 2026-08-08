import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import {
  applyMeasurements,
  commonValue,
  prefill,
  selectedWalls,
  wallLength,
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

    expect(applyMeasurements(session, [wall], edits({ length: '6' }))).toEqual(
      [],
    );

    expect(wall.getBaseline().a).toEqual(point(-1, 0));
    expect(wall.getBaseline().b).toEqual(point(5, 0));
    expect(wallLength(wall)).toBeCloseTo(6);
  });

  it('keeps the wall bearing when the length changes', () => {
    const id = addWall(0, 0, 3, 4); // 5 m at 3-4-5
    const wall = wallOf(id);

    applyMeasurements(session, [wall], edits({ length: '10' }));

    const { a, b } = wall.getBaseline();
    expect(wallLength(wall)).toBeCloseTo(10);
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
    );

    for (const wall of walls) {
      expect(wall.getHeight()).toBeCloseTo(2.4);
      expect(wall.getThickness()).toBeCloseTo(0.2);
    }
  });

  it('ignores length for a multi-wall selection, applying the rest', () => {
    const walls = [addWall(0, 0, 4, 0), addWall(0, 4, 4, 4)].map(wallOf);

    applyMeasurements(session, walls, edits({ length: '9', height: '2.4' }));

    for (const wall of walls) {
      expect(wallLength(wall)).toBeCloseTo(4);
      expect(wall.getHeight()).toBeCloseTo(2.4);
    }
  });

  it('leaves blank fields alone', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    applyMeasurements(session, [wall], edits({ height: '2.4' }));

    expect(wallLength(wall)).toBeCloseTo(4);
    expect(wall.getThickness()).toBeCloseTo(0.3);
  });

  it('applies length and height as one undo', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    applyMeasurements(session, [wall], edits({ length: '6', height: '2.4' }));
    session.undo();

    expect(wallLength(wall)).toBeCloseTo(4);
    expect(wall.getHeight()).toBeCloseTo(3);
  });

  it('reports bad fields and changes nothing at all', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    const bad = applyMeasurements(
      session,
      [wall],
      edits({ length: '6', height: 'tall' }),
    );

    expect(bad).toEqual(['height']);
    // the good field must not land on its own — the dialog stays open
    expect(wallLength(wall)).toBeCloseTo(4);
  });

  it('treats zero and negative sizes as bad input', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));
    expect(applyMeasurements(session, [wall], edits({ length: '0' }))).toEqual([
      'length',
    ]);
    expect(applyMeasurements(session, [wall], edits({ height: '-2' }))).toEqual(
      ['height'],
    );
  });

  it('accepts a unit suffix, overriding the display unit', () => {
    const wall = wallOf(addWall(0, 0, 4, 0));

    applyMeasurements(session, [wall], edits({ thickness: '200 mm' }));

    expect(wall.getThickness()).toBeCloseTo(0.2);
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
