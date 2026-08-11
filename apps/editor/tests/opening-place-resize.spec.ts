import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  HostedOpeningEntity,
  WallEntity,
  point,
} from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';

/**
 * Touch flow for openings: press on a wall and drag along it to place a
 * window at the width you dragged; grab an end of a placed one and drag to
 * resize it from that side. Driven through the real tools, so this covers the
 * path the finger takes, not just the commands underneath.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

const down = (p: Point) =>
  runtime.tools.pointerDown({ point: p, modifiers: NO_MODS, snapped: false });
const move = (p: Point) =>
  runtime.tools.pointerMove({ point: p, modifiers: NO_MODS, snapped: false });
const up = (p: Point) =>
  runtime.tools.pointerUp({ point: p, modifiers: NO_MODS, snapped: false });

const drag = (from: Point, to: Point) => {
  down(from);
  move(to);
  up(to);
};

const tap = (p: Point) => {
  down(p);
  up(p);
};

const pending = () => runtime.ui.overlay.get().pending;

/** the one wall every test hangs its openings on: 10 m along the x axis */
const addWall = (): EntityId =>
  session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(10, 0),
    thickness: 0.3,
  });

const openings = () =>
  session.doc.all().filter(
    (e): e is HostedOpeningEntity =>
      // the entity under test, whatever concrete opening type it is
      e instanceof HostedOpeningEntity,
  );

const only = (): HostedOpeningEntity => {
  const all = openings();
  expect(all).toHaveLength(1);
  return all[0];
};

/** the opening's ends in metres along the wall — what the user sees */
const span = (opening: HostedOpeningEntity) => {
  const wall = session.doc
    .all()
    .find((e): e is WallEntity => e instanceof WallEntity);
  const len = wall ? wall.getLength() : 0;
  const centre = opening.t * len;
  return {
    start: centre - opening.width / 2,
    end: centre + opening.width / 2,
  };
};

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
});

describe('placing an opening by dragging', () => {
  beforeEach(() => {
    addWall();
    runtime.tools.useById('window');
  });

  it('claims a press on a wall so the finger drags instead of panning', () => {
    expect(runtime.tools.hitDraggable(point(3, 0), 0.1)).toBe(true);
    expect(runtime.tools.hitDraggable(point(3, 5), 0.1)).toBe(false);
  });

  it('spans the opening from the press point to the release point', () => {
    drag(point(2, 0), point(4, 0));

    const window = only();
    expect(window.width).toBeCloseTo(2, 6);
    expect(window.t).toBeCloseTo(0.3, 6); // centre at 3 m of 10
    expect(span(window).start).toBeCloseTo(2, 6);
    expect(span(window).end).toBeCloseTo(4, 6);
  });

  it('drags backwards just as well', () => {
    drag(point(7, 0), point(5.5, 0));

    const window = only();
    expect(window.width).toBeCloseTo(1.5, 6);
    expect(span(window).start).toBeCloseTo(5.5, 6);
  });

  it('previews the span while dragging, and clears it on release', () => {
    down(point(2, 0));
    expect(pending()).not.toBeNull();
    move(point(4, 0));
    expect(pending()?.a.x).toBeCloseTo(2, 6);
    expect(pending()?.b.x).toBeCloseTo(4, 6);
    // nothing placed until the finger lifts
    expect(openings()).toHaveLength(0);

    up(point(4, 0));
    expect(pending()).toBeNull();
  });

  it('sizes off the wall it started on, even if the finger wanders off', () => {
    drag(point(2, 0), point(4, 3));

    // the drag is projected back onto the host wall: 2 m of width, on the axis
    const window = only();
    expect(window.width).toBeCloseTo(2, 6);
    expect(span(window).end).toBeCloseTo(4, 6);
  });

  it('still places the default width on a tap', () => {
    tap(point(2, 0));

    const window = only();
    expect(window.width).toBeCloseTo(1, 6); // WINDOW.ADD's own default
    expect(window.t).toBeCloseTo(0.2, 6);
  });

  it('treats a drag too short to be a size as a tap', () => {
    drag(point(2, 0), point(2.1, 0));

    expect(only().width).toBeCloseTo(1, 6);
  });

  it('keeps the opening inside the wall', () => {
    drag(point(9, 0), point(14, 0));

    const window = only();
    expect(span(window).start).toBeGreaterThanOrEqual(-1e-9);
    expect(span(window).end).toBeLessThanOrEqual(10 + 1e-9);
    expect(window.width).toBeCloseTo(1, 6); // clipped at the wall end
  });

  it('places nothing when the press misses every wall', () => {
    drag(point(2, 5), point(4, 5));

    expect(openings()).toHaveLength(0);
    expect(pending()).toBeNull();
  });

  it('drops the placement on Escape, without putting the tool away', () => {
    down(point(2, 0));
    runtime.tools.key('Escape');

    expect(pending()).toBeNull();
    expect(openings()).toHaveLength(0);
    expect(runtime.ui.activeToolId.get()).toBe('window');
  });

  it('is one undo per opening', () => {
    session.history.clear();
    drag(point(2, 0), point(4, 0));
    expect(openings()).toHaveLength(1);

    session.undo();
    expect(openings()).toHaveLength(0);
    expect(session.history.canUndo).toBe(false);
  });

  it('places a door at the door default too', () => {
    runtime.tools.useById('door');
    tap(point(5, 0));

    expect(only().width).toBeCloseTo(0.9, 6);
  });
});

describe('resizing an opening by dragging its ends', () => {
  let wallId: EntityId;
  let windowId: EntityId;

  beforeEach(() => {
    wallId = addWall();
    // 2 m wide, centred at 5 m: ends at 4 and 6
    windowId = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId,
      t: 0.5,
      width: 2,
    });
    session.selection.add(windowId);
    runtime.tools.useById('select');
  });

  const window = () => session.doc.get(windowId) as HostedOpeningEntity;

  it('offers a grip at each end as well as the middle', () => {
    const grips = window().getGrips();
    expect(grips.map((g) => g.index)).toEqual([0, 1, 2]);
    expect(grips[0].point.x).toBeCloseTo(5, 6);
    expect(grips[1].point.x).toBeCloseTo(4, 6);
    expect(grips[2].point.x).toBeCloseTo(6, 6);
  });

  it('grows from the dragged end, leaving the far end where it was', () => {
    drag(point(6, 0), point(8, 0));

    expect(window().width).toBeCloseTo(4, 6);
    expect(span(window()).start).toBeCloseTo(4, 6);
    expect(span(window()).end).toBeCloseTo(8, 6);
  });

  it('shrinks from the dragged end the same way', () => {
    drag(point(4, 0), point(5, 0));

    expect(window().width).toBeCloseTo(1, 6);
    expect(span(window()).start).toBeCloseTo(5, 6);
    expect(span(window()).end).toBeCloseTo(6, 6);
  });

  it('previews the resize while dragging', () => {
    down(point(6, 0));
    move(point(8, 0));

    expect(pending()?.a.x).toBeCloseTo(4, 6);
    expect(pending()?.b.x).toBeCloseTo(8, 6);
    // still the original width until the finger lifts
    expect(window().width).toBeCloseTo(2, 6);

    up(point(8, 0));
    expect(pending()).toBeNull();
  });

  it('is one undo step', () => {
    session.history.clear();
    drag(point(6, 0), point(8, 0));
    expect(window().width).toBeCloseTo(4, 6);

    session.undo();
    expect(window().width).toBeCloseTo(2, 6);
    expect(window().t).toBeCloseTo(0.5, 6);
    expect(session.history.canUndo).toBe(false);
  });

  it('keeps the opening inside its wall', () => {
    drag(point(6, 0), point(14, 0));

    expect(span(window()).end).toBeLessThanOrEqual(10 + 1e-9);
    expect(span(window()).start).toBeGreaterThanOrEqual(-1e-9);
    expect(window().width).toBeCloseTo(6, 6); // fixed end at 4, wall ends at 10
  });

  it('never collapses to nothing', () => {
    drag(point(4, 0), point(6, 0));

    expect(window().width).toBeCloseTo(HostedOpeningEntity.MIN_WIDTH, 6);
    expect(span(window()).end).toBeCloseTo(6, 6);
  });

  it('still slides the whole opening from the middle grip', () => {
    drag(point(5, 0), point(3, 0));

    expect(window().width).toBeCloseTo(2, 6);
    expect(window().t).toBeCloseTo(0.3, 6);
  });

  it('costs no undo step when the end grip is only tapped', () => {
    session.history.clear();
    tap(point(6, 0));

    expect(session.history.canUndo).toBe(false);
    expect(window().width).toBeCloseTo(2, 6);
  });

  it('leaves the host wall alone', () => {
    drag(point(6, 0), point(8, 0));

    const wall = session.doc.get(wallId) as WallEntity;
    expect(wall.getLength()).toBeCloseTo(10, 6);
  });
});
