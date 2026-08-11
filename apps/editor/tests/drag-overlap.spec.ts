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
import { duplicateSelection } from '@/app/components/layout/footer/duplicate';
import { wallDimensions } from '@/editor/viewport/wall-dimensions';

/**
 * Dragging is how walls actually end up doubled: copy a room, drop it on an
 * existing wall, and without a resolve behind the move the two sit stacked.
 * These drive the real tool, so they cover the path the finger takes.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

// setup goes straight to the session: these walls are clean by construction,
// and it is the DRAG that has to do the resolving
const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const room = (x0: number, y0: number, x1: number, y1: number) => {
  const corners = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return corners.map((a, i) => addWall(a, corners[(i + 1) % corners.length]));
};

const walls = () =>
  session.doc.all().filter((e): e is WallEntity => e instanceof WallEntity);

/** every wall as a rounded span, sorted — the plan's whole geometry */
const spans = () =>
  walls()
    .map((w) => {
      const { a, b } = w.getBaseline();
      const r = (n: number) => Math.round(n * 100) / 100;
      return `${r(a.x)},${r(a.y)}→${r(b.x)},${r(b.y)}`;
    })
    .sort();

/** total centreline metres — doubling shows up here even when spans look sane */
const totalLength = () => walls().reduce((sum, w) => sum + w.getLength(), 0);

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

describe('dragging a wall onto another', () => {
  it('does not leave two walls stacked on one run', () => {
    addWall(point(0, 0), point(6, 0));
    const loose = addWall(point(0, 3), point(4, 3));
    session.selection.add(loose);

    // drag it straight down onto the first wall
    drag(point(2, 3), point(2, 0));

    // 0–4 belongs to the older wall, so the dragged one keeps nothing there
    expect(totalLength()).toBeCloseTo(6, 6);
    expect(spans()).toEqual(['0,0→4,0', '4,0→6,0']);
  });

  // grabbing an endpoint stretches it rather than moving the wall — which is
  // exactly how a wall gets connected INTO another one
  it('splits the host where a stretched end tees into it', () => {
    addWall(point(0, 0), point(6, 0));
    const stub = addWall(point(3, 2), point(3, 5));
    session.selection.add(stub);

    drag(point(3, 2), point(3, 0));

    // the host is cut at the tee, so both pieces are real, measurable walls
    expect(spans()).toEqual(['0,0→3,0', '3,0→3,5', '3,0→6,0']);
  });
});

describe('dragging a copied room onto an existing room', () => {
  it('shares the party wall instead of stacking two', () => {
    room(0, 0, 6, 4);
    const copy = room(0, 6, 6, 10);
    session.selection.clear();
    for (const id of copy) session.selection.add(id);

    // grab the copy by its top wall and drop it so its bottom edge lands
    // exactly on the first room's top edge
    drag(point(3, 10), point(3, 8));

    // 8 walls became 7: the shared run exists once
    expect(walls()).toHaveLength(7);
    expect(totalLength()).toBeCloseTo(6 * 3 + 4 * 4, 6);
    expect(detectSpaces(session.doc, null)).toHaveLength(2);
  });

  it('splits the wall it lands on when the rooms are different widths', () => {
    // the screenshot: a narrow room brought up under a wider pair
    room(0, 4, 8, 8);
    const narrow = room(2, -4, 6, 0);
    session.selection.clear();
    for (const id of narrow) session.selection.add(id);

    drag(point(4, -4), point(4, 0));

    // the wide room's bottom wall is cut at both of the narrow room's sides,
    // so its pieces are separately measurable rather than one 8 m span
    const onTheLine = spans().filter(
      (s) => s.includes(',4→') && s.endsWith(',4'),
    );
    expect(onTheLine).toEqual(['0,4→2,4', '2,4→6,4', '6,4→8,4']);
    expect(detectSpaces(session.doc, null)).toHaveLength(2);
  });

  it('gives every resulting piece its own dimension', () => {
    room(0, 4, 8, 8);
    const narrow = room(2, -4, 6, 0);
    session.selection.clear();
    for (const id of narrow) session.selection.add(id);

    drag(point(4, -4), point(4, 0));

    const dims = wallDimensions(session.doc, { kind: 'plan', levelId: null });
    // every piece is measured; walls that measure the same span share one
    // dimension, so there are never MORE dimensions than walls
    expect(dims.length).toBeLessThanOrEqual(walls().length);
    const lengths = dims.map((d) => Math.round(d.length * 100) / 100);
    // the cut wall's two outer pieces: 2 m of centreline plus the miter where
    // each still meets the room's corner
    expect(lengths.filter((n) => n === 2.15)).toHaveLength(2);
    // and no ghost of the 8 m wall it used to be
    expect(lengths).not.toContain(8);
  });
});

describe('duplicating', () => {
  it('resolves the copy against whatever it lands on', () => {
    // a wall exactly where the copy will be dropped (bbox width 4 + 1 m gap)
    addWall(point(0, 0), point(4, 0));
    addWall(point(5, 0), point(9, 0));
    session.selection.add(walls()[0].id);

    duplicateSelection(session, runtime.ui);

    // the copy lands on 5–9, which is already taken: no doubling
    expect(totalLength()).toBeCloseTo(8, 6);
  });
});

describe('what dragging must not break', () => {
  it('leaves a clean move alone', () => {
    const loose = addWall(point(0, 3), point(4, 3));
    session.selection.add(loose);

    drag(point(2, 3), point(2, 5));

    expect(walls()).toHaveLength(1);
    expect(spans()).toEqual(['0,5→4,5']);
  });

  it('is still one undo', () => {
    addWall(point(0, 0), point(6, 0));
    const loose = addWall(point(0, 3), point(4, 3));
    session.selection.add(loose);
    const before = spans();

    drag(point(2, 3), point(2, 0));
    session.undo();

    expect(spans()).toEqual(before);
  });

  it('keeps room walls joined after a drag', () => {
    const ids = room(0, 0, 6, 4);
    session.selection.clear();
    for (const id of ids) session.selection.add(id);

    drag(point(3, 2), point(5, 2));

    expect(detectSpaces(session.doc, null)).toHaveLength(1);
  });
});
