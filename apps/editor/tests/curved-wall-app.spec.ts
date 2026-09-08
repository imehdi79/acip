import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import { DEFAULT_SWEEP, allCurved, toggleCurve } from '@/editor/curve';
import {
  applyMeasurements,
  sweepPrefill,
  type JogEdits,
  type MeasureView,
} from '@/app/components/layout/footer/measurements';
import { labelledWallLength } from '@/editor/viewport/wall-dimensions';

/**
 * Curving a wall from the app: the footer button decides WHETHER a wall bows,
 * the handle on the wall and the Measurements angle decide by how much.
 */

let session: EditorSession;
const PLAN: ViewDefinition = { kind: 'plan', levelId: null };
const VIEW: MeasureView = { levelId: null, mode: 'outside' };
const QUARTER = Math.PI / 2;

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;
const select = (...ids: EntityId[]) => {
  session.selection.clear();
  for (const id of ids) session.selection.add(id);
};

const noJogs: JogEdits = {
  start: { on: false, size: '' },
  end: { on: false, size: '' },
};

const applySweep = (id: EntityId, sweep: string) =>
  applyMeasurements(
    session,
    [wallOf(id)],
    { length: '', height: '', thickness: '' },
    VIEW,
    'push',
    noJogs,
    sweep,
  );

beforeEach(() => {
  session = new EditorSession();
});

describe('the footer button', () => {
  it('bows a straight wall', () => {
    const id = addWall(point(0, 0), point(4, 0));
    select(id);
    toggleCurve(session);
    expect(wallOf(id).isCurved()).toBe(true);
    expect(wallOf(id).getSweep()).toBeCloseTo(DEFAULT_SWEEP, 9);
  });

  it('bows it enough to see', () => {
    // a sweep too small to notice reads as the button being broken, and the
    // user presses it again
    const id = addWall(point(0, 0), point(4, 0));
    select(id);
    toggleCurve(session);
    const apex = wallOf(id).getGrips()[2].point;
    expect(Math.abs(apex.y)).toBeGreaterThan(0.1);
  });

  it('straightens it again on a second press', () => {
    const id = addWall(point(0, 0), point(4, 0));
    select(id);
    toggleCurve(session);
    toggleCurve(session);
    expect(wallOf(id).isCurved()).toBe(false);
  });

  it('is one undo step', () => {
    const id = addWall(point(0, 0), point(4, 0));
    select(id);
    toggleCurve(session);
    session.history.undo();
    expect(wallOf(id).isCurved()).toBe(false);
  });

  it('curves a whole room at once', () => {
    const c = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    const ids = c.map((a, i) => addWall(a, c[(i + 1) % c.length]));
    select(...ids);
    toggleCurve(session);
    expect(allCurved(ids.map(wallOf))).toBe(true);
  });

  it('curves a mixed selection rather than straightening it', () => {
    // undoing a press is cheap; getting a shape back is not, so the safe
    // direction is the one that adds
    const bent = addWall(point(0, 0), point(4, 0));
    const straight = addWall(point(0, 2), point(4, 2));
    session.dispatch('WALL.SETARC', { ids: [bent], sweep: 1 });
    select(bent, straight);
    toggleCurve(session);
    expect(wallOf(straight).isCurved()).toBe(true);
    expect(wallOf(bent).isCurved()).toBe(true);
  });

  it('does nothing with nothing selected', () => {
    addWall(point(0, 0), point(4, 0));
    expect(() => toggleCurve(session)).not.toThrow();
  });
});

describe('the curve angle in Measurements', () => {
  const curved = () => {
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETARC', { ids: [id], sweep: QUARTER });
    return id;
  };

  it('is shown in degrees, which is what people type', () => {
    // radians are the storage unit and nobody types them; the radius of a
    // gentle curve is a huge number that swings wildly for a small shape change
    expect(Number(sweepPrefill(wallOf(curved())))).toBeCloseTo(90, 1);
  });

  it('is blank for a straight wall', () => {
    expect(sweepPrefill(wallOf(addWall(point(0, 0), point(4, 0))))).toBe('');
  });

  it('sets the curve from degrees', () => {
    const id = curved();
    expect(applySweep(id, '45')).toEqual([]);
    expect(wallOf(id).getSweep()).toBeCloseTo(Math.PI / 4, 6);
  });

  it('bows the other way for a negative angle', () => {
    const id = curved();
    applySweep(id, '-45');
    expect(wallOf(id).getSweep()).toBeCloseTo(-Math.PI / 4, 6);
  });

  it('leaves the curve alone when blank', () => {
    // blank means "do not touch this", not "straighten" — the footer button is
    // how a wall is straightened, and a blank box undoing a curve is a trap
    const id = curved();
    applySweep(id, '');
    expect(wallOf(id).getSweep()).toBeCloseTo(QUARTER, 9);
  });

  it('reports an angle it cannot use instead of guessing', () => {
    const id = curved();
    expect(applySweep(id, 'abc')).toEqual(['sweep']);
    expect(wallOf(id).getSweep()).toBeCloseTo(QUARTER, 9);
  });

  it('refuses a full turn, which has no chord left to draw', () => {
    const id = curved();
    expect(applySweep(id, '360')).toEqual(['sweep']);
  });

  it('changes nothing at all when it reports', () => {
    const id = curved();
    applyMeasurements(
      session,
      [wallOf(id)],
      { length: '', height: '3.5', thickness: '' },
      VIEW,
      'push',
      noJogs,
      'abc',
    );
    expect(wallOf(id).getHeight()).not.toBeCloseTo(3.5, 6);
  });

  it('leaves several walls uncurved, since a shape is not shared', () => {
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(0, 2), point(4, 2));
    applyMeasurements(
      session,
      [wallOf(a), wallOf(b)],
      { length: '', height: '3', thickness: '' },
      VIEW,
      'push',
      noJogs,
      '45',
    );
    expect(wallOf(a).isCurved()).toBe(false);
    expect(wallOf(b).isCurved()).toBe(false);
    expect(wallOf(a).getHeight()).toBeCloseTo(3, 6); // the shared edit lands
  });
});

describe('what a curved wall reads as on the plan', () => {
  it('is dimensioned with its arc length, not its chord', () => {
    // the chord is a number nobody can buy material against
    const id = addWall(point(0, 0), point(4, 0));
    const straight = labelledWallLength(session.doc, PLAN, wallOf(id));
    session.dispatch('WALL.SETARC', { ids: [id], sweep: QUARTER });
    const curved = labelledWallLength(session.doc, PLAN, wallOf(id));
    expect(curved).toBeGreaterThan(straight ?? 0);
    expect(curved).toBeCloseTo(wallOf(id).getLength(), 6);
  });

  it('still dimensions a straight wall exactly as before', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(labelledWallLength(session.doc, PLAN, wallOf(id))).toBeCloseTo(4, 6);
  });
});
