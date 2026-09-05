import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import {
  applyMeasurements,
  jogPrefill,
  type JogEdits,
  type MeasureView,
} from '@/app/components/layout/footer/measurements';

/**
 * The corner-step controls in the measurements dialog: a switch and a size per
 * corner, which is the only way to state a jog — there is nothing on a
 * phone-sized plan to grab that would say it.
 */

let session: EditorSession;
const VIEW: MeasureView = { levelId: null, mode: 'outside' };

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;

const blank = { length: '', height: '', thickness: '' };
const noJogs: JogEdits = {
  start: { on: false, size: '' },
  end: { on: false, size: '' },
};

const apply = (id: EntityId, jogs: JogEdits, edits = blank) =>
  applyMeasurements(session, [wallOf(id)], edits, VIEW, 'push', jogs);

beforeEach(() => {
  session = new EditorSession();
});

describe('turning a corner step on', () => {
  it('steps the wall by what was typed', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(apply(id, { ...noJogs, end: { on: true, size: '0.10' } })).toEqual(
      [],
    );
    expect(wallOf(id).getJog('end')).toBeCloseTo(0.1, 6);
  });

  it('steps the other way for a negative size', () => {
    // the only way to say which side, since there is no third control
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { ...noJogs, end: { on: true, size: '-0.10' } });
    expect(wallOf(id).getJog('end')).toBeCloseTo(-0.1, 6);
  });

  it('leaves the other corner alone', () => {
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, { ...noJogs, end: { on: true, size: '0.10' } });
    expect(wallOf(id).getJog('start')).toBe(0);
  });

  it('steps both corners when both are asked for', () => {
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, {
      start: { on: true, size: '0.05' },
      end: { on: true, size: '0.10' },
    });
    expect(wallOf(id).getJog('start')).toBeCloseTo(0.05, 6);
    expect(wallOf(id).getJog('end')).toBeCloseTo(0.1, 6);
  });
});

describe('turning one off', () => {
  it('removes the step', () => {
    // switching off is a real instruction, not a blank field to skip over
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    apply(id, noJogs);
    expect(wallOf(id).getJog('end')).toBe(0);
  });

  it('needs no size to do it', () => {
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    expect(apply(id, noJogs)).toEqual([]);
  });
});

describe('a switch that is on with nothing usable in its box', () => {
  it('is reported rather than silently ignored', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(apply(id, { ...noJogs, end: { on: true, size: 'abc' } })).toEqual([
      'jogEnd',
    ]);
  });

  it('names the corner it means', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(apply(id, { ...noJogs, start: { on: true, size: '' } })).toEqual([
      'jogStart',
    ]);
  });

  it('rejects a step of nothing, which is what the switch already says', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(apply(id, { ...noJogs, end: { on: true, size: '0' } })).toEqual([
      'jogEnd',
    ]);
  });

  it('changes nothing at all when it reports', () => {
    // a bad step must not land a good one on its own and leave it half done
    const id = addWall(point(0, 0), point(4, 0));
    apply(id, {
      start: { on: true, size: '0.05' },
      end: { on: true, size: 'abc' },
    });
    expect(wallOf(id).getJog('start')).toBe(0);
  });
});

describe('a step and a length in one go', () => {
  it('both land', () => {
    const id = addWall(point(0, 0), point(4, 0));
    const edits = { length: '6', height: '', thickness: '' };
    expect(
      apply(id, { ...noJogs, end: { on: true, size: '0.10' } }, edits),
    ).toEqual([]);
    expect(wallOf(id).getLength()).toBeCloseTo(6, 6);
    expect(wallOf(id).getJog('end')).toBeCloseTo(0.1, 6);
  });

  it('undo as one step, because it was one Apply', () => {
    const id = addWall(point(0, 0), point(4, 0));
    apply(
      id,
      { ...noJogs, end: { on: true, size: '0.10' } },
      { length: '6', height: '', thickness: '' },
    );
    session.history.undo();
    expect(wallOf(id).getLength()).toBeCloseTo(4, 6);
    expect(wallOf(id).getJog('end')).toBe(0);
  });
});

describe('what the dialog shows when it opens', () => {
  it('shows the corners off for a wall that does not step', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(jogPrefill(wallOf(id))).toEqual({
      start: { on: false, size: '' },
      end: { on: false, size: '' },
    });
  });

  it('shows a stepped corner on, with its step', () => {
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    const shown = jogPrefill(wallOf(id));
    expect(shown.end.on).toBe(true);
    expect(Number(shown.end.size)).toBeCloseTo(0.1, 6);
    expect(shown.start.on).toBe(false);
  });
});

describe('several walls at once', () => {
  it('leave their corners alone', () => {
    // a jog belongs to one corner, and six walls have no corner in common —
    // the same reason Length is single-wall only
    const a = addWall(point(0, 0), point(4, 0));
    const b = addWall(point(0, 2), point(4, 2));
    applyMeasurements(
      session,
      [wallOf(a), wallOf(b)],
      { length: '', height: '3', thickness: '' },
      VIEW,
      'push',
      { ...noJogs, end: { on: true, size: '0.10' } },
    );
    expect(wallOf(a).getJog('end')).toBe(0);
    expect(wallOf(b).getJog('end')).toBe(0);
    expect(wallOf(a).getHeight()).toBeCloseTo(3, 6); // the shared edit still lands
  });
});
