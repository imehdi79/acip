import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, classifySelection, point } from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';

/**
 * Tools consume abstract input, never DOM events, so the whole select
 * behaviour is drivable headlessly — this is the port actually working, not
 * just compiling.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

/** 4 x 4 m closed room at the origin */
function buildRoom(): EntityId[] {
  const corners = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
  return corners.map((a, i) =>
    session.dispatch<EntityId>('WALL.ADD', {
      a,
      b: corners[(i + 1) % corners.length],
    }),
  );
}

const click = (p: Point, mods = NO_MODS) => {
  runtime.tools.pointerDown({ point: p, modifiers: mods, snapped: false });
  runtime.tools.pointerUp({ point: p, modifiers: mods });
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

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
});

describe('SelectTool', () => {
  it('starts on the select tool', () => {
    expect(runtime.ui.activeToolId.get()).toBe('select');
  });

  it('clicking a wall selects it', () => {
    const [bottom] = buildRoom();
    click(point(2, 0));
    expect(session.selection.list()).toEqual([bottom]);
  });

  it('clicking another wall replaces the selection', () => {
    const [bottom, right] = buildRoom();
    click(point(2, 0));
    click(point(4, 2));
    expect(session.selection.list()).toEqual([right]);
    expect(session.selection.has(bottom)).toBe(false);
  });

  it('shift-clicking adds to the selection', () => {
    const [bottom, right] = buildRoom();
    click(point(2, 0));
    click(point(4, 2), { ...NO_MODS, shift: true });
    expect(new Set(session.selection.list())).toEqual(new Set([bottom, right]));
  });

  it('clicking empty space inside a room selects its boundary walls', () => {
    const ids = buildRoom();
    click(point(2, 2)); // dead centre, on no wall
    expect(new Set(session.selection.list())).toEqual(new Set(ids));
  });

  it('a room click classifies as a room, which is what the footer gates on', () => {
    buildRoom();
    click(point(2, 2));
    const info = classifySelection(session.doc, session.selection.list());
    expect(info.kind).toBe('room');
    expect(info.count).toBe(4);
  });

  it('a crossing box (right to left) selects everything it touches', () => {
    const ids = buildRoom();
    drag(point(6, -2), point(-2, 6));
    expect(new Set(session.selection.list())).toEqual(new Set(ids));
  });

  it('Escape clears the selection', () => {
    buildRoom();
    click(point(2, 0));
    expect(session.selection.size).toBe(1);
    runtime.tools.key('Escape');
    expect(session.selection.size).toBe(0);
  });

  it('a hosted window is selectable, and mixes with its wall', () => {
    const [bottom] = buildRoom();
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: bottom,
      t: 0.5,
      width: 1,
    });

    // the window spans x 1.5..2.5 and sits on top of the wall there
    click(point(2, 0));
    expect(session.selection.list()).toEqual([window]);
    expect(classifySelection(session.doc, session.selection.list()).kind).toBe(
      'window',
    );

    // clear of the opening, so the wall itself is the top hit
    click(point(0.5, 0), { ...NO_MODS, shift: true });
    const info = classifySelection(session.doc, session.selection.list());
    expect(info.types).toEqual(['wall', 'window']);
    expect(info.kind).toBe('mixed');
  });
});
