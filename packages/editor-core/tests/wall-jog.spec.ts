import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  loadDocumentInto,
  point,
  saveDocument,
} from '../src/index.js';
import type { EntityId, Point } from '../src/index.js';

/**
 * A JOG is the small sideways step where two runs of wall meet out of line:
 * one face carries on past the corner while the other steps in. It is the
 * per-corner override deferred beyond joins V2 — the one thing about a
 * junction the drawing cannot derive, because it is a decision rather than a
 * consequence.
 */

const round = (p: Point) => ({
  x: Math.round(p.x * 1e6) / 1e6,
  y: Math.round(p.y * 1e6) / 1e6,
});

const session = () => new EditorSession();

const addWall = (s: EditorSession, a: Point, b: Point, thickness = 0.3) =>
  s.dispatch<EntityId>('WALL.ADD', { a, b, thickness });

const wallOf = (s: EditorSession, id: EntityId) => s.doc.get(id) as WallEntity;
const outline = (s: EditorSession, id: EntityId) =>
  wallOf(s, id).getOutline().map(round);

/** the face positions across the wall */
const ySpan = (pts: readonly Point[]) => ({
  min: Math.min(...pts.map((p) => p.y)),
  max: Math.max(...pts.map((p) => p.y)),
});

describe('a wall with no jog', () => {
  test('is the same four-cornered wall it always was', () => {
    // the whole feature has to cost nothing until it is asked for
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    expect(outline(s, id)).toEqual([
      { x: 0, y: 0.15 },
      { x: 4, y: 0.15 },
      { x: 4, y: -0.15 },
      { x: 0, y: -0.15 },
    ]);
  });

  test('reports no jog at either end', () => {
    const s = session();
    const wall = wallOf(s, addWall(s, point(0, 0), point(4, 0)));
    expect(wall.getJog('start')).toBe(0);
    expect(wall.getJog('end')).toBe(0);
  });
});

describe('a jogged end', () => {
  test('steps the whole wall sideways, both faces together', () => {
    // the drawing this comes from: past the step the run sits shifted, so the
    // outer face goes up and the inner face goes up with it
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    const atEnd = outline(s, id).filter((p) => p.x === 4);
    expect(atEnd.map((p) => p.y).sort()).toEqual([-0.05, 0.25]);
    // still 0.30 thick where it steps — a jog offsets, it does not thicken
    expect(0.25 - -0.05).toBeCloseTo(0.3, 9);
  });

  test('adds a riser to each face and nothing else', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    // each stepped face trades its one square corner for the three of a
    // riser, so a jogged end costs four points and two ends cost eight
    expect(outline(s, id)).toHaveLength(8);
  });

  test('leaves the far end exactly where it was', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    const atStart = outline(s, id).filter((p) => p.x === 0);
    expect(atStart.map((p) => p.y).sort()).toEqual([-0.15, 0.15]);
  });

  test('steps the other way for a negative offset', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: -0.1 });
    const atEnd = outline(s, id).filter((p) => p.x === 4);
    expect(atEnd.map((p) => p.y).sort()).toEqual([-0.25, 0.05]);
  });

  test('steps both ends when both are jogged', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'start', offset: 0.1 });
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: -0.1 });
    expect(outline(s, id)).toHaveLength(12);
    expect(ySpan(outline(s, id))).toEqual({ min: -0.25, max: 0.25 });
  });

  test('goes back to an ordinary wall when set to zero', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0 });
    expect(outline(s, id)).toHaveLength(4);
  });
});

describe('what a jog does NOT touch', () => {
  test('the baseline, so length is still the length', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    const { a, b } = wallOf(s, id).getBaseline();
    expect(round(a)).toEqual({ x: 0, y: 0 });
    expect(round(b)).toEqual({ x: 4, y: 0 });
    expect(wallOf(s, id).getLength()).toBeCloseTo(4, 9);
  });

  test('the joins, which are still found at the same corner', () => {
    // a jog is how the corner is DRAWN; moving the baseline instead would
    // break the junction apart and lose the neighbour entirely
    const s = session();
    const a = addWall(s, point(0, 0), point(4, 0));
    const b = addWall(s, point(4, 0), point(4, 3));
    s.dispatch('WALL.SETJOG', { ids: [a], which: 'end', offset: 0.1 });
    expect(wallOf(s, a).getJoinsAt('end')).toHaveLength(1);
    expect(wallOf(s, b).getJoinsAt('start')).toHaveLength(1);
  });

  test('the grips, so it can still be dragged by the corner it jogs at', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    expect(
      wallOf(s, id)
        .getGrips()
        .map((g) => round(g.point)),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 4, y: 0 },
    ]);
  });
});

describe('a jog and a miter do not both shape the corner', () => {
  test('a jogged end stops mitering', () => {
    /*
     * Both want to place the same two points, so one has to yield, or which
     * corner you got would depend on which ran last. Stating a jog is stating
     * what this corner does — the join opt-out the docs pair with per-corner
     * overrides.
     */
    const s = session();
    const a = addWall(s, point(0, 0), point(4, 0));
    addWall(s, point(4, 0), point(4, 3));
    expect(outline(s, a).filter((p) => p.x > 4).length).toBeGreaterThan(0);

    s.dispatch('WALL.SETJOG', { ids: [a], which: 'end', offset: 0.1 });
    expect(outline(s, a).filter((p) => p.x > 4)).toHaveLength(0);
  });

  test('the other end keeps its miter', () => {
    // opting one corner out must not opt the wall out
    const s = session();
    const a = addWall(s, point(0, 0), point(4, 0));
    addWall(s, point(0, 0), point(0, 3));
    s.dispatch('WALL.SETJOG', { ids: [a], which: 'end', offset: 0.1 });
    expect(outline(s, a).some((p) => p.x < 0)).toBe(true);
  });
});

describe('a jog survives', () => {
  test('a save and a reload', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    const reopened = new EditorSession();
    loadDocumentInto(reopened.doc, saveDocument(s.doc), reopened.entityTypes);
    expect(wallOf(reopened, id).getJog('end')).toBeCloseTo(0.1, 9);
  });

  test('being copied', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    expect(wallOf(s, id).clone().getJog('end')).toBeCloseTo(0.1, 9);
  });

  test('an undo, which puts the corner back', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    s.history.undo();
    expect(wallOf(s, id).getJog('end')).toBe(0);
    expect(outline(s, id)).toHaveLength(4);
  });
});

describe('a wall that has never been jogged', () => {
  test('saves exactly what it always saved', () => {
    // a new file must not grow two zeroes on every wall in the drawing
    const s = session();
    addWall(s, point(0, 0), point(4, 0));
    const saved = JSON.stringify(saveDocument(s.doc));
    expect(saved).not.toContain('jogStart');
    expect(saved).not.toContain('jogEnd');
  });

  test('reads a file written before jogs existed as having none', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    const data = JSON.parse(JSON.stringify(saveDocument(s.doc)));
    const reopened = new EditorSession();
    loadDocumentInto(reopened.doc, data, reopened.entityTypes);
    expect(wallOf(reopened, id).getJog('start')).toBe(0);
  });
});

describe('the 3D wall', () => {
  test('is still a closed solid when an end steps', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    s.dispatch('WALL.SETJOG', { ids: [id], which: 'end', offset: 0.1 });
    const mesh = wallOf(s, id).toMesh('coarse');
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  });
});
