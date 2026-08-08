import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';

/**
 * Touch flow for drawing a wall: press plants a provisional wall that blinks,
 * dragging aims it, releasing commits it. A press that never moves falls back
 * to tap-tap chaining.
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

const walls = () =>
  session.doc.all().filter((e): e is WallEntity => e instanceof WallEntity);
const pending = () => runtime.ui.overlay.get().pending;

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
  runtime.tools.useById('wall');
});

describe('wall drag-to-draw', () => {
  it('claims the press, so a one-finger drag draws instead of panning', () => {
    expect(runtime.tools.hitDraggable(point(0, 0), 0.1)).toBe(true);
  });

  it('shows a provisional wall the instant the finger lands', () => {
    expect(pending()).toBeNull();
    down(point(1, 1));
    // zero length so far — it is the "your touch registered" marker
    expect(pending()).toEqual({ a: point(1, 1), b: point(1, 1) });
    expect(walls()).toHaveLength(0);
  });

  it('drags the provisional wall with the finger', () => {
    down(point(0, 0));
    move(point(3, 0));
    expect(pending()?.a).toEqual(point(0, 0));
    expect(pending()?.b.x).toBeCloseTo(3, 6);
    expect(pending()?.b.y).toBeCloseTo(0, 6);
    // still nothing committed until release
    expect(walls()).toHaveLength(0);
  });

  it('commits the wall on release, and clears the provisional one', () => {
    down(point(0, 0));
    move(point(4, 0));
    up(point(4, 0));

    const drawn = walls();
    expect(drawn).toHaveLength(1);
    const { a, b } = drawn[0].getBaseline();
    expect(a).toEqual(point(0, 0));
    expect(b.x).toBeCloseTo(4, 6);
    expect(b.y).toBeCloseTo(0, 6);
    expect(pending()).toBeNull();
  });

  it('draws one wall per gesture — the next press starts fresh', () => {
    down(point(0, 0));
    move(point(4, 0));
    up(point(4, 0));

    // a second press must not chain a wall off the first one's end
    down(point(10, 10));
    expect(walls()).toHaveLength(1);
    expect(pending()).toEqual({ a: point(10, 10), b: point(10, 10) });
  });

  it('is one undo step per wall', () => {
    session.history.clear();
    down(point(0, 0));
    move(point(4, 0));
    up(point(4, 0));
    expect(walls()).toHaveLength(1);

    session.undo();
    expect(walls()).toHaveLength(0);
    expect(session.history.canUndo).toBe(false);
  });

  it('treats a press that never moved as a tap, not a zero-length wall', () => {
    down(point(2, 2));
    up(point(2, 2));
    expect(walls()).toHaveLength(0);
    // the first point stays planted, so tap-tap still works
    expect(pending()).not.toBeNull();
  });

  it('completes a wall by tap-tap when there is no drag', () => {
    down(point(0, 0));
    up(point(0, 0));
    down(point(0, 5));
    up(point(0, 5));

    const drawn = walls();
    expect(drawn).toHaveLength(1);
    const { a, b } = drawn[0].getBaseline();
    expect(a).toEqual(point(0, 0));
    expect(b.x).toBeCloseTo(0, 6);
    expect(b.y).toBeCloseTo(5, 6);
  });

  it('clears the provisional wall on Escape', () => {
    down(point(1, 1));
    expect(pending()).not.toBeNull();
    runtime.tools.key('Escape');
    expect(pending()).toBeNull();
    expect(walls()).toHaveLength(0);
  });

  it('clears the provisional wall when the tool is put away', () => {
    down(point(1, 1));
    runtime.tools.useById('select');
    expect(pending()).toBeNull();
  });
});
