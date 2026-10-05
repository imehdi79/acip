import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, LayerId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { BEND_STANDOFF_PX, bendHandles } from '@/editor/curve';

/**
 * Curving a wall by dragging the button on its middle.
 *
 * The button is the whole feature: a wall is bent by pulling it, not by typing
 * an angle, so these drive the tool the way a finger does — down on the button,
 * move, up — and read the wall afterwards.
 *
 * The one thing it must not cost is the gesture it sits next to. Dragging a
 * wall by its body still moves the wall, its middle included, which is why the
 * button stands OFF the wall rather than on it.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

const addWall = (a: Point, b: Point, layerId?: LayerId) =>
  session.dispatch<EntityId>('WALL.ADD', {
    a,
    b,
    thickness: 0.3,
    ...(layerId ? { layerId } : {}),
  });

const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;

const select = (...ids: EntityId[]) => {
  session.selection.clear();
  for (const id of ids) session.selection.add(id);
};

const drag = (from: Point, to: Point) => {
  runtime.tools.pointerDown({
    point: from,
    modifiers: NO_MODS,
    snapped: false,
  });
  runtime.tools.pointerMove({ point: to, modifiers: NO_MODS, snapped: false });
  runtime.tools.pointerUp({ point: to, modifiers: NO_MODS });
};

/** the buttons as the renderer would draw them, at the runtime's live zoom */
const handles = () =>
  bendHandles(
    session.doc,
    session.selection.list(),
    BEND_STANDOFF_PX / runtime.ui.camera.get().scale,
  );

const buttonOf = (id: EntityId) => {
  const handle = handles().find((h) => h.wallId === id);
  if (!handle) throw new Error('no bend button on that wall');
  return handle;
};

/** pull a wall's button `by` meters across the wall */
const pull = (id: EntityId, by: number) => {
  const button = buttonOf(id).point;
  drag(button, { x: button.x, y: button.y + by });
};

/** a 6 m wall along +x, selected and ready to bend */
const selectedWall = () => {
  const id = addWall(point(0, 0), point(6, 0));
  select(id);
  return id;
};

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
});

describe('the button on the middle of a wall', () => {
  it('appears on a selected wall', () => {
    const id = selectedWall();
    expect(handles().map((h) => h.wallId)).toEqual([id]);
  });

  it('stands off the wall, so the wall itself is still free to grab', () => {
    const id = selectedWall();
    const button = buttonOf(id);
    expect(button.anchor).toEqual(point(3, 0));
    expect(button.point.x).toBeCloseTo(3, 9);
    expect(wallOf(id).hitTest(button.point, 0)).toBe(false);
  });

  it('is not offered on a wall nobody selected', () => {
    addWall(point(0, 0), point(6, 0));
    expect(handles()).toEqual([]);
  });

  it('is not offered on a locked wall, which would refuse the change', () => {
    const id = selectedWall();
    for (const layer of session.doc.layersList()) {
      session.dispatch('LAYER.UPDATE', { id: layer.id, locked: true });
    }
    expect(handles().find((h) => h.wallId === id)).toBeUndefined();
  });

  it('answers a touch drag, so a finger on it does not pan the plan', () => {
    const id = selectedWall();
    expect(runtime.tools.hitDraggable(buttonOf(id).point, 0.1)).toBe(true);
  });

  it('follows the wall onto the curve once it is bent', () => {
    // a second drag has to start from where the wall IS, not from the chord it
    // left behind
    const id = selectedWall();
    pull(id, 1);
    expect(buttonOf(id).anchor).toEqual(wallOf(id).getBendPoint());
  });
});

describe('dragging it', () => {
  it('curves the wall', () => {
    const id = selectedWall();
    pull(id, 1);
    expect(wallOf(id).isCurved()).toBe(true);
  });

  it('bows the wall by as much as the finger moved across it', () => {
    const id = selectedWall();
    pull(id, 1);
    expect(wallOf(id).getBendPoint().y).toBeCloseTo(1, 6);
  });

  it('leaves both ends exactly where they were', () => {
    // the wall stores a sweep and not a centre precisely so that everything
    // welded to those two points stays welded
    const id = selectedWall();
    const before = wallOf(id).getBaseline();
    pull(id, 1.5);
    expect(wallOf(id).getBaseline()).toEqual(before);
  });

  it('makes the wall longer, because a bowed wall is its arc', () => {
    const id = selectedWall();
    pull(id, 1);
    expect(wallOf(id).getLength()).toBeGreaterThan(6);
  });

  it('bows the other way when pulled the other way', () => {
    const id = selectedWall();
    pull(id, -1);
    expect(wallOf(id).getSweep()).toBeLessThan(0);
    expect(wallOf(id).getBendPoint().y).toBeCloseTo(-1, 6);
  });

  it('straightens the wall again when pulled back flat', () => {
    const id = selectedWall();
    pull(id, 1);
    pull(id, -1);
    expect(wallOf(id).isCurved()).toBe(false);
  });

  it('is one undo step, and undoing gives back the straight wall', () => {
    const id = selectedWall();
    pull(id, 1);
    session.history.undo();
    expect(wallOf(id).isCurved()).toBe(false);
  });

  it('costs nothing when the button is only tapped', () => {
    const id = selectedWall();
    const button = buttonOf(id).point;
    drag(button, button);
    expect(wallOf(id).isCurved()).toBe(false);
    // the only thing left on the undo stack is the wall being drawn, so a tap
    // on the button put nothing there
    session.history.undo();
    expect(session.doc.get(id)).toBeNull();
  });

  it('previews the wall it is about to commit', () => {
    const id = selectedWall();
    const button = buttonOf(id).point;
    const to = { x: button.x, y: button.y + 1 };
    runtime.tools.pointerDown({
      point: button,
      modifiers: NO_MODS,
      snapped: false,
    });
    runtime.tools.pointerMove({
      point: to,
      modifiers: NO_MODS,
      snapped: false,
    });
    const preview = runtime.ui.overlay.get().ghost?.[0];
    runtime.tools.pointerUp({ point: to, modifiers: NO_MODS });

    expect(preview?.kind).toBe('polyline');
    if (preview?.kind !== 'polyline') return;
    expect(preview.points).toEqual(wallOf(id).getCentreline());
  });

  it('carries a window round with the wall it is cut into', () => {
    const id = selectedWall();
    const win = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: id,
      t: 0.5,
      width: 1,
    });
    select(id);
    pull(id, 1);
    expect(session.doc.get(win)?.getGrips()[0].point.y).toBeCloseTo(1, 6);
  });
});

describe('what the button must not take away', () => {
  it('dragging the wall by its middle still MOVES the wall', () => {
    // the middle of a wall is the natural place to grab it, which is exactly
    // why the button is not sitting there
    const id = selectedWall();
    drag(point(3, 0), point(3, -2));
    expect(wallOf(id).getBaseline().a).toEqual(point(0, -2));
    expect(wallOf(id).isCurved()).toBe(false);
  });

  it('dragging an end still stretches the wall', () => {
    const id = selectedWall();
    drag(point(6, 0), point(8, 0));
    expect(wallOf(id).getBaseline().b).toEqual(point(8, 0));
    expect(wallOf(id).isCurved()).toBe(false);
  });

  it('bending one wall of a room leaves the corners welded', () => {
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    const ids = corners.map((a, i) => addWall(a, corners[(i + 1) % 4]));
    select(ids[0]);
    pull(ids[0], -1);

    expect(wallOf(ids[0]).isCurved()).toBe(true);
    expect(wallOf(ids[0]).getBaseline()).toEqual({
      a: point(0, 0),
      b: point(6, 0),
    });
    for (const id of ids.slice(1)) expect(wallOf(id).isCurved()).toBe(false);
  });
});
