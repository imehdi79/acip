import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  point,
} from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';

/**
 * Move-separately: dragging a wall normally carries the walls welded to it, so
 * a room keeps its shape. With the footer toggle on, the selection travels on
 * its own and its neighbours stay exactly where they are.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const room = (x0: number, y0: number, x1: number, y1: number) => {
  const corners = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return corners.map((a, i) => addWall(a, corners[(i + 1) % corners.length]));
};

const baseline = (id: EntityId) =>
  (session.doc.get(id) as WallEntity).getBaseline();

const drag = (from: Point, to: Point) => {
  runtime.tools.pointerDown({
    point: from,
    modifiers: NO_MODS,
    snapped: false,
  });
  runtime.tools.pointerMove({ point: to, modifiers: NO_MODS, snapped: false });
  runtime.tools.pointerUp({ point: to, modifiers: NO_MODS, snapped: false });
};

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
  runtime.tools.useById('select');
});

describe('the default: joins are carried', () => {
  it('stretches the neighbours to follow a moved wall', () => {
    const ids = room(0, 0, 6, 4);
    session.selection.add(ids[0]); // the bottom wall

    drag(point(3, 0), point(3, -2));

    // the side walls stretched down with it, so the room is still closed
    expect(baseline(ids[1]).a).toEqual(point(6, -2));
    expect(baseline(ids[3]).b).toEqual(point(0, -2));
    expect(detectSpaces(session.doc, null)).toHaveLength(1);
  });
});

describe('with move-separately on', () => {
  beforeEach(() => {
    runtime.ui.detachedMove.set(true);
  });

  it('leaves the neighbours exactly where they were', () => {
    const ids = room(0, 0, 6, 4);
    const before = [baseline(ids[1]), baseline(ids[2]), baseline(ids[3])];
    session.selection.add(ids[0]);

    drag(point(3, 0), point(3, -2));

    expect([baseline(ids[1]), baseline(ids[2]), baseline(ids[3])]).toEqual(
      before,
    );
  });

  it('moves the selected wall on its own', () => {
    const ids = room(0, 0, 6, 4);
    session.selection.add(ids[0]);

    drag(point(3, 0), point(3, -2));

    expect(baseline(ids[0])).toEqual({ a: point(0, -2), b: point(6, -2) });
  });

  it('lifts a wall out of the junction, so the room opens', () => {
    const ids = room(0, 0, 6, 4);
    session.selection.add(ids[0]);

    drag(point(3, 0), point(3, -2));

    // that is the point of the mode: the loop is broken on purpose
    expect(detectSpaces(session.doc, null)).toEqual([]);
  });

  it('moves a whole room without touching what it was joined to', () => {
    const upper = room(0, 4, 6, 8);
    const lower = room(0, 0, 6, 4);
    const untouched = lower.map((id) => baseline(id));
    session.selection.clear();
    for (const id of upper) session.selection.add(id);

    drag(point(3, 8), point(3, 11));

    expect(lower.map((id) => baseline(id))).toEqual(untouched);
    // the upper room travelled intact
    expect(detectSpaces(session.doc, null).length).toBeGreaterThanOrEqual(1);
  });

  it('is still one undo', () => {
    const ids = room(0, 0, 6, 4);
    const before = baseline(ids[0]);
    session.selection.add(ids[0]);

    drag(point(3, 0), point(3, -2));
    session.undo();

    expect(baseline(ids[0])).toEqual(before);
  });

  it('goes back to carrying joins when switched off', () => {
    const ids = room(0, 0, 6, 4);
    session.selection.add(ids[0]);
    runtime.ui.detachedMove.set(false);

    drag(point(3, 0), point(3, -2));

    expect(baseline(ids[1]).a).toEqual(point(6, -2));
  });

  it('still resolves an overlap the move creates', () => {
    addWall(point(0, 0), point(6, 0));
    const loose = addWall(point(0, 3), point(4, 3));
    session.selection.add(loose);

    drag(point(2, 3), point(2, 0));

    // detaching from joins does not mean stacking walls is suddenly allowed
    const total = session.doc
      .all()
      .filter((e): e is WallEntity => e instanceof WallEntity)
      .reduce((sum, w) => sum + w.getLength(), 0);
    expect(total).toBeCloseTo(6, 6);
  });
});
