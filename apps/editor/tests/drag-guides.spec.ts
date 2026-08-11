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
import { planDragSnap } from '@/editor/tools/drafting';

/**
 * Dragging a room is how rooms get joined, so the corners of the dragged
 * selection are what snap — not the fingertip. Guides show what it is lining
 * up with; a corner within reach sticks exactly.
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

const select = (ids: EntityId[]) => {
  session.selection.clear();
  for (const id of ids) session.selection.add(id);
};

const down = (p: Point) =>
  runtime.tools.pointerDown({ point: p, modifiers: NO_MODS, snapped: false });
const move = (p: Point) =>
  runtime.tools.pointerMove({ point: p, modifiers: NO_MODS, snapped: false });
const up = (p: Point) =>
  runtime.tools.pointerUp({ point: p, modifiers: NO_MODS, snapped: false });

const guides = () => runtime.ui.overlay.get().guides;
const snapMark = () => runtime.ui.overlay.get().snap;

const baseline = (id: EntityId) =>
  (session.doc.get(id) as WallEntity).getBaseline();

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.2;
  runtime.tools.useById('select');
});

describe('planDragSnap', () => {
  it('does nothing when there is nothing to snap to', () => {
    const only = addWall(point(0, 0), point(4, 0));
    const out = planDragSnap(session.doc, new Set([only]), point(1, 1), 0.3);
    expect(out.delta).toEqual(point(1, 1));
    expect(out.guides).toEqual([]);
    expect(out.stuck).toBeNull();
  });

  it('sticks a corner exactly onto a nearby one', () => {
    addWall(point(0, 0), point(4, 0));
    const loose = addWall(point(0, 5), point(4, 5));

    // dropped 4 cm short of the corner at (0,0)
    const out = planDragSnap(
      session.doc,
      new Set([loose]),
      point(0, -4.96),
      0.3,
    );

    expect(out.stuck).not.toBeNull();
    expect(out.stuck!.point).toEqual(point(0, 0));
    // the whole selection shifts so the corners coincide exactly
    expect(out.delta.y).toBeCloseTo(-5, 9);
  });

  it('leaves a corner alone once it is out of reach', () => {
    addWall(point(0, 0), point(4, 0));
    const loose = addWall(point(0, 5), point(4, 5));

    const out = planDragSnap(session.doc, new Set([loose]), point(0, -4), 0.3);
    expect(out.stuck).toBeNull();
    expect(out.delta).toEqual(point(0, -4));
  });

  it('tracks alignment with a guide when not close enough to stick', () => {
    addWall(point(0, 0), point(4, 0));
    const loose = addWall(point(0, 5), point(4, 5));

    // 3 cm off vertically aligned, but 2 m away along y — no stick, but the
    // x of both corners lines up
    const out = planDragSnap(
      session.doc,
      new Set([loose]),
      point(0.03, -2),
      0.3,
    );

    expect(out.stuck).toBeNull();
    expect(out.delta.x).toBeCloseTo(0, 9);
    expect(out.guides.length).toBeGreaterThan(0);
    // the guide runs from the corner it is tracking to where the corner landed
    expect(out.guides[0].a).toEqual(point(0, 0));
  });

  it('prefers the nearest corner when several are in reach', () => {
    addWall(point(0, 0), point(4, 0));
    const loose = addWall(point(10, 0), point(14, 0));

    // the loose wall's left end is being brought to (4,0), nearer than (0,0)
    const out = planDragSnap(
      session.doc,
      new Set([loose]),
      point(-5.9, 0),
      0.3,
    );
    expect(out.stuck!.point).toEqual(point(4, 0));
  });

  it('never snaps a selection to itself', () => {
    const ids = room(0, 0, 6, 4);
    const out = planDragSnap(session.doc, new Set(ids), point(0.05, 0.05), 0.3);
    expect(out.stuck).toBeNull();
    expect(out.delta).toEqual(point(0.05, 0.05));
  });
});

describe('dragging with the select tool', () => {
  it('shows a snap marker as a room comes into reach', () => {
    room(0, 0, 6, 4);
    const copy = room(0, 6, 6, 10);
    select(copy);

    down(point(3, 6));
    // drag the copy down so its bottom-left corner nears (0,4)
    move(point(3, 4.1));

    expect(snapMark()).not.toBeNull();
    expect(snapMark()!.point).toEqual(point(0, 4));
  });

  it('shows tracking guides while it is only lining up', () => {
    room(0, 0, 6, 4);
    const loose = addWall(point(0, 8), point(4, 8));
    select([loose]);

    // a real drag, but landing 4 m clear of anything: no stick, while the
    // left ends still line up on x
    down(point(2, 8));
    move(point(2.05, 7.5));

    expect(snapMark()).toBeNull();
    expect(guides()).not.toBeNull();
    expect(guides()!.length).toBeGreaterThan(0);
  });

  it('clears the guides and the marker when the drag ends', () => {
    room(0, 0, 6, 4);
    const copy = room(0, 6, 6, 10);
    select(copy);

    down(point(3, 6));
    move(point(3, 4.1));
    up(point(3, 4.1));

    expect(guides()).toBeNull();
    expect(snapMark()).toBeNull();
  });

  it('commits the snapped position, not the raw cursor', () => {
    room(0, 0, 6, 4);
    const copy = room(0, 6, 6, 10);
    select(copy);

    // released 10 cm short — the corners still have to coincide exactly
    down(point(3, 6));
    move(point(3, 4.1));
    up(point(3, 4.1));

    // the copy's bottom wall duplicated the room's top wall and was erased as
    // part of the same drop, so the right wall is what proves the landing
    expect(session.doc.get(copy[0])).toBeNull();
    expect(baseline(copy[1])).toEqual({ a: point(6, 4), b: point(6, 8) });
  });

  it('welds the rooms: the shared wall exists once and both rooms detect', () => {
    room(0, 0, 6, 4);
    const copy = room(0, 6, 6, 10);
    select(copy);

    down(point(3, 6));
    move(point(3, 4.1));
    up(point(3, 4.1));

    const walls = session.doc
      .all()
      .filter((e): e is WallEntity => e instanceof WallEntity);
    // 8 walls minus the duplicated party wall
    expect(walls).toHaveLength(7);
    expect(detectSpaces(session.doc, null)).toHaveLength(2);
  });

  it('still moves freely when nothing is in reach', () => {
    const loose = addWall(point(0, 0), point(4, 0));
    addWall(point(0, 20), point(4, 20));
    select([loose]);

    down(point(2, 0));
    move(point(3.3, 1.7));
    up(point(3.3, 1.7));

    expect(baseline(loose).a.x).toBeCloseTo(1.3, 9);
    expect(baseline(loose).a.y).toBeCloseTo(1.7, 9);
  });
});
