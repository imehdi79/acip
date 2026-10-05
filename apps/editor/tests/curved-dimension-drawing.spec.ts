import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import { Viewport2D } from '@/editor/viewport/viewport2d';
import { drawPlanDimensions } from '@/editor/viewport/scene-renderer';
import { formatLength } from '@/editor/units';
import { planDimensions } from '@/editor/viewport/wall-dimensions';

/**
 * What actually reaches the canvas for a bowed wall.
 *
 * The geometry is proved in curved-dimensions.spec.ts; this is the other half
 * of the same promise — that the line drawn is the boundary that was measured.
 * A number is only honest if the linework beside it spans what it claims, and
 * the way that fails is a straight chord with an arc length written on it.
 */

const PLAN: ViewDefinition = { kind: 'plan', levelId: null };

/** the canvas calls that matter, recorded */
interface Drawn {
  moves: number;
  lines: number;
  texts: string[];
  dashed: boolean;
}

/** everything the pass calls but this test has no opinion about */
const noop = (): void => undefined;

function recordingCanvas(): { canvas: HTMLCanvasElement; drawn: Drawn } {
  const drawn: Drawn = { moves: 0, lines: 0, texts: [], dashed: false };
  const ctx = {
    setTransform: noop,
    save: noop,
    restore: noop,
    translate: noop,
    rotate: noop,
    beginPath: noop,
    stroke: noop,
    fill: noop,
    arc: noop,
    fillRect: noop,
    strokeRect: noop,
    strokeText: noop,
    setLineDash: (pattern: number[]) => {
      if (pattern.length > 0) drawn.dashed = true;
    },
    moveTo: () => {
      drawn.moves += 1;
    },
    lineTo: () => {
      drawn.lines += 1;
    },
    fillText: (text: string) => {
      drawn.texts.push(text);
    },
    measureText: () => ({ width: 10 }),
    font: '',
    textAlign: '',
    textBaseline: '',
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
  };
  const canvas = {
    width: 800,
    height: 600,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  return { canvas, drawn };
}

let session: EditorSession;
let viewport: Viewport2D;

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const draw = (mode: 'inside' | 'outside') => {
  const { canvas, drawn } = recordingCanvas();
  drawPlanDimensions(canvas, viewport, session.doc, PLAN, new Set(), mode);
  return drawn;
};

const printedFor = (id: EntityId, mode: 'inside' | 'outside') =>
  planDimensions(session.doc, PLAN, new Set(), mode).find(
    (dim) => dim.entityId === id,
  );

beforeEach(() => {
  (globalThis as { window?: unknown }).window = { devicePixelRatio: 1 };
  session = new EditorSession();
  viewport = new Viewport2D();
  viewport.scale = 60;
  viewport.offsetX = 100;
  viewport.offsetY = 500;
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

describe('drawing a bowed wall’s dimension', () => {
  const bowed = () => {
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETARC', { ids: [id], sweep: Math.PI / 3 });
    return id;
  };

  it('follows the arc instead of spanning the chord', () => {
    // a straight wall's dimension is one moveTo and one lineTo plus its two
    // witness lines; an arc is walked in many pieces
    const id = bowed();
    const curved = draw('outside').lines;
    session = new EditorSession();
    addWall(point(0, 0), point(4, 0));
    const straight = draw('outside').lines;
    expect(curved).toBeGreaterThan(straight * 4);
    void id;
  });

  it('prints the arc length the layout measured, in the plan’s own units', () => {
    const id = bowed();
    const dim = printedFor(id, 'outside');
    expect(draw('outside').texts).toContain(formatLength(dim?.length ?? 0));
  });

  it('prints the depth of that same boundary beside it', () => {
    const id = bowed();
    const dim = printedFor(id, 'outside');
    expect(draw('outside').texts).toContain(
      formatLength(dim?.curve?.depth ?? 0),
    );
  });

  it('prints the INNER arc and the inner depth in inside mode', () => {
    const id = bowed();
    const dim = printedFor(id, 'inside');
    const texts = draw('inside').texts;
    expect(texts).toContain(formatLength(dim?.length ?? 0));
    expect(texts).toContain(formatLength(dim?.curve?.depth ?? 0));
    // and they are a different pair of numbers than outside mode prints
    expect(texts).not.toEqual(draw('outside').texts);
  });

  it('draws the chord the depth stands on as a reference line, dashed', () => {
    bowed();
    expect(draw('outside').dashed).toBe(true);
    session = new EditorSession();
    addWall(point(0, 0), point(4, 0));
    expect(draw('outside').dashed).toBe(false);
  });

  it('keeps the same two numbers when the plan is zoomed', () => {
    const id = bowed();
    const near = draw('outside').texts;
    viewport.scale = 240;
    expect(draw('outside').texts).toEqual(near);
    void id;
  });

  it('drops the depth arrow on a bow too shallow to see, keeping the length', () => {
    const id = addWall(point(0, 0), point(4, 0));
    session.dispatch('WALL.SETARC', { ids: [id], sweep: 0.004 });
    const dim = printedFor(id, 'outside');
    const texts = draw('outside').texts;
    expect(texts).toContain(formatLength(dim?.length ?? 0));
    expect(texts).not.toContain(formatLength(dim?.curve?.depth ?? 0));
  });

  it('draws nothing for a wall too small on screen to label', () => {
    const id = addWall(point(0, 0), point(0.2, 0));
    session.dispatch('WALL.SETARC', { ids: [id], sweep: Math.PI / 3 });
    viewport.scale = 2;
    expect(draw('outside').texts).toEqual([]);
  });
});

describe('what a straight wall still draws', () => {
  it('one dimension line and two witness lines, as before', () => {
    addWall(point(0, 0), point(4, 0));
    const drawn = draw('outside');
    expect(drawn.moves).toBe(3);
    expect(drawn.lines).toBe(3);
    expect(drawn.dashed).toBe(false);
  });

  it('its own length, and nothing about depth', () => {
    const id = addWall(point(0, 0), point(4, 0));
    const dim = printedFor(id, 'outside');
    expect(draw('outside').texts).toEqual([formatLength(dim?.length ?? 0)]);
  });
});
