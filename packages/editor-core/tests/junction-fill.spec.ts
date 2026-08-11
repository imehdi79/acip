import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  point,
  resolveJunction,
} from '../src/index.js';
import type { EntityId, Point, WallEnd } from '../src/index.js';

/**
 * A junction has to be watertight: no white slivers between walls that meet.
 * The rule is the drafting one — whichever wall runs straight through stays
 * continuous and the others stop at its face.
 */

const end = (dx: number, dy: number, halfWidth = 0.15): WallEnd => ({
  point: point(0, 0),
  direction: point(dx, dy),
  halfWidth,
});

const round = (p: Point) => ({
  x: Math.round(p.x * 1e6) / 1e6,
  y: Math.round(p.y * 1e6) / 1e6,
});

describe('resolveJunction', () => {
  test('a straight run keeps square caps on both faces', () => {
    // ──┼──  the classic T stem is missing: just two walls in line
    const caps = resolveJunction([end(1, 0), end(-1, 0)]);
    expect(round(caps[0].left)).toEqual({ x: 0, y: 0.15 });
    expect(round(caps[0].right)).toEqual({ x: 0, y: -0.15 });
  });

  test('a T leaves no sliver: the run is square, the stem butts its face', () => {
    //      ──┬──   run along x, stem heading down
    const caps = resolveJunction([end(1, 0), end(-1, 0), end(0, -1)]);

    // both halves of the run reach the junction line at BOTH faces — this is
    // the fix: a mitered corner here chamfers them and opens a triangle
    for (const cap of [caps[0], caps[1]]) {
      expect(Math.abs(round(cap.left).x)).toBe(0);
      expect(Math.abs(round(cap.right).x)).toBe(0);
    }
    // the stem stops on the run's near face, spanning its own thickness
    expect(round(caps[2].left)).toEqual({ x: 0.15, y: -0.15 });
    expect(round(caps[2].right)).toEqual({ x: -0.15, y: -0.15 });
  });

  test('a thick run owns the face a thin partition stops at', () => {
    const caps = resolveJunction([
      end(1, 0, 0.25),
      end(-1, 0, 0.25),
      end(0, -1, 0.05),
    ]);
    // the partition butts the 0.25 face, not its own
    expect(round(caps[2].left).y).toBe(-0.25);
    expect(round(caps[2].right).y).toBe(-0.25);
  });

  test('a plain L corner still miters', () => {
    // no wall runs through, so the wheel keeps its shared outer corner
    const caps = resolveJunction([end(1, 0), end(0, -1)]);
    expect(round(caps[0].left)).toEqual({ x: -0.15, y: 0.15 });
  });

  test('at a crossing X runs through and Y stops at its faces', () => {
    //      │
    //   ───┼───   only one run can stay continuous, or the two overlap
    //      │
    const caps = resolveJunction([
      end(1, 0),
      end(-1, 0),
      end(0, 1),
      end(0, -1),
    ]);

    // the horizontal run carries on: square caps on the junction line
    for (const cap of [caps[0], caps[1]]) {
      expect(round(cap.left).x).toBe(0);
      expect(round(cap.right).x).toBe(0);
    }
    // the vertical arms stop on the face they arrive at, each on its own side
    expect(round(caps[2].left).y).toBe(0.15);
    expect(round(caps[2].right).y).toBe(0.15);
    expect(round(caps[3].left).y).toBe(-0.15);
    expect(round(caps[3].right).y).toBe(-0.15);
  });

  test('a vertical run still carries on when nothing horizontal runs through', () => {
    // X priority only decides between two RUNS — a lone arm never wins
    const caps = resolveJunction([end(0, 1), end(0, -1), end(1, 0)]);
    expect(round(caps[0].left).y).toBe(0);
    expect(round(caps[0].right).y).toBe(0);
    expect(round(caps[2].left).x).toBe(0.15);
  });

  test('near-collinear counts as a run, so float dust cannot open a spike', () => {
    const caps = resolveJunction([end(1, 0), end(-1, 1e-9), end(0, -1)]);
    expect(Math.abs(round(caps[0].left).x)).toBe(0);
  });
});

/* -------------------------------------------------------------------------- */

const addWall = (session: EditorSession, a: Point, b: Point, thickness = 0.3) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness });

/** the wall's plan outline, rounded for comparison */
const outline = (session: EditorSession, id: EntityId) =>
  (session.doc.get(id) as WallEntity).getOutline().map(round);

describe('the plan at a real junction', () => {
  test('a room hung under a split wall leaves no gap at either corner', () => {
    const session = new EditorSession();
    // the screenshot: a band across the top, a room hanging below it
    addWall(session, point(0, 4), point(8, 4));
    addWall(session, point(2, 0), point(2, 4));
    addWall(session, point(6, 0), point(6, 4));
    addWall(session, point(2, 0), point(6, 0));
    session.dispatch('WALL.RESOLVE', {});

    const walls = session.doc
      .all()
      .filter((e): e is WallEntity => e instanceof WallEntity);
    const band = walls.filter((w) => {
      const { a, b } = w.getBaseline();
      return a.y === 4 && b.y === 4;
    });
    expect(band).toHaveLength(3);

    // every piece of the band is a clean rectangle: its two ends sit square
    // on the junction line, so consecutive pieces share an edge exactly
    for (const piece of band) {
      const pts = outline(session, piece.id);
      const xs = [...new Set(pts.map((p) => p.x))].sort((m, n) => m - n);
      expect(xs).toHaveLength(2);
      const ys = [...new Set(pts.map((p) => p.y))].sort((m, n) => m - n);
      expect(ys).toEqual([3.85, 4.15]);
    }
  });

  test('the stem stops at the face, so it never pokes through', () => {
    const session = new EditorSession();
    addWall(session, point(0, 4), point(8, 4));
    const stem = addWall(session, point(4, 0), point(4, 4));
    session.dispatch('WALL.RESOLVE', {});

    const top = Math.max(...outline(session, stem).map((p) => p.y));
    // the band's underside, not its centreline and not its top
    expect(top).toBe(3.85);
  });

  test('an L corner is still mitered to the outer point', () => {
    const session = new EditorSession();
    const a = addWall(session, point(0, 0), point(4, 0));
    addWall(session, point(4, 0), point(4, 3));

    // the corner reaches the outside of both walls
    expect(outline(session, a)).toContainEqual({ x: 4.15, y: -0.15 });
  });
});
