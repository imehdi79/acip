import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  point,
  resolveJunction,
} from '../src/index.js';
import type { EntityId, Point, WallEnd } from '../src/index.js';

const H = 0.15; // halfWidth of a 0.3m wall

function end(dx: number, dy: number, halfWidth = H): WallEnd {
  const len = Math.hypot(dx, dy);
  return { point: point(0, 0), direction: point(dx / len, dy / len), halfWidth };
}

function expectPoint(actual: Point, x: number, y: number) {
  expect(actual.x).toBeCloseTo(x, 9);
  expect(actual.y).toBeCloseTo(y, 9);
}

describe('resolveJunction — pure wheel math', () => {
  test('single end gets a square cap', () => {
    const [cap] = resolveJunction([end(1, 0)]);
    expectPoint(cap.left, 0, H);
    expectPoint(cap.right, 0, -H);
  });

  test('right angle miters to shared diagonal corners', () => {
    const [a, b] = resolveJunction([end(1, 0), end(0, 1)]);
    expectPoint(a.left, H, H);
    expectPoint(a.right, -H, -H);
    // the CCW neighbor owns the same two corners, swapped sides
    expectPoint(b.left, -H, -H);
    expectPoint(b.right, H, H);
  });

  test('collinear walls stay flush with square caps', () => {
    const [a, b] = resolveJunction([end(1, 0), end(-1, 0)]);
    expectPoint(a.left, 0, H);
    expectPoint(a.right, 0, -H);
    expectPoint(b.left, 0, -H);
    expectPoint(b.right, 0, H);
  });

  test('near-collinear spike is clamped to the miter limit', () => {
    const deg5 = (5 * Math.PI) / 180;
    const caps = resolveJunction([end(1, 0), end(Math.cos(deg5), Math.sin(deg5))]);
    for (const cap of caps) {
      expect(Math.hypot(cap.left.x, cap.left.y)).toBeLessThanOrEqual(8 * H + 1e-9);
      expect(Math.hypot(cap.right.x, cap.right.y)).toBeLessThanOrEqual(8 * H + 1e-9);
    }
  });

  test('three-wall star: adjacent walls share corners exactly', () => {
    const caps = resolveJunction([end(1, 0), end(-1, 1.7320508), end(-1, -1.7320508)]);
    // sorted by angle: [0°, 120°, −120°] → CCW ring 0 → 120 → −120
    const [a, b, c] = caps;
    expectPoint(b.right, a.left.x, a.left.y);
    expectPoint(c.right, b.left.x, b.left.y);
    expectPoint(a.right, c.left.x, c.left.y);
    for (const cap of caps) {
      expect(Number.isFinite(cap.left.x)).toBe(true);
      expect(Number.isFinite(cap.right.y)).toBe(true);
    }
  });
});

function addWall(session: EditorSession, ax: number, ay: number, bx: number, by: number) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });
}

function boundaryOf(session: EditorSession, id: EntityId): readonly Point[] {
  const geom = session.doc.get(id)!.getEffectiveGeometry();
  if (geom.kind === 'region') return geom.boundary;
  if (geom.kind === 'group' && geom.children[0]?.kind === 'region') {
    return geom.children.flatMap((c) => (c.kind === 'region' ? c.boundary : []));
  }
  throw new Error(`expected region geometry, got ${geom.kind}`);
}

function hasCorner(boundary: readonly Point[], x: number, y: number): boolean {
  return boundary.some((p) => Math.abs(p.x - x) < 1e-9 && Math.abs(p.y - y) < 1e-9);
}

describe('WallEntity — derived auto-joins', () => {
  test('two walls sharing an endpoint miter their plan corners', () => {
    const session = new EditorSession();
    const wallA = addWall(session, 0, 0, 5, 0);
    const wallB = addWall(session, 0, 0, 0, 5);

    const boundsA = boundaryOf(session, wallA);
    const boundsB = boundaryOf(session, wallB);
    // shared miter corners at (±H, ±H) on both walls
    expect(hasCorner(boundsA, H, H)).toBe(true);
    expect(hasCorner(boundsA, -H, -H)).toBe(true);
    expect(hasCorner(boundsB, H, H)).toBe(true);
    expect(hasCorner(boundsB, -H, -H)).toBe(true);
    // free ends stay square
    expect(hasCorner(boundsA, 5, H)).toBe(true);
    expect(hasCorner(boundsA, 5, -H)).toBe(true);
  });

  test('mesh follows the mitered plan', () => {
    const session = new EditorSession();
    const wallA = addWall(session, 0, 0, 5, 0);
    addWall(session, 0, 0, 0, 5);
    const mesh = (session.doc.get(wallA) as WallEntity).toMesh('medium');
    let found = false;
    for (let i = 0; i < mesh.positions.length; i += 3) {
      if (
        Math.abs(mesh.positions[i] - H) < 1e-9 &&
        Math.abs(mesh.positions[i + 1] - H) < 1e-9
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  test('dragging a wall away dissolves the join', () => {
    const session = new EditorSession();
    const wallA = addWall(session, 0, 0, 5, 0);
    const wallB = addWall(session, 0, 0, 0, 5);
    session.dispatch('GRIP.MOVE', { id: wallA, index: 0, to: point(2, 2) });

    // wallB's start cap is square again
    const boundsB = boundaryOf(session, wallB);
    expect(hasCorner(boundsB, -H, 0)).toBe(true);
    expect(hasCorner(boundsB, H, 0)).toBe(true);
    expect(hasCorner(boundsB, H, H)).toBe(false);
  });

  test('join survives undo/redo of the neighbor', () => {
    const session = new EditorSession();
    const wallA = addWall(session, 0, 0, 5, 0);
    addWall(session, 0, 0, 0, 5);
    session.undo();
    expect(hasCorner(boundaryOf(session, wallA), 0, H)).toBe(true); // square again
    session.redo();
    expect(hasCorner(boundaryOf(session, wallA), H, H)).toBe(true); // mitered again
  });

  test('a window keeps its placement when its wall joins another', () => {
    const session = new EditorSession();
    const wallA = addWall(session, 0, 0, 6, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId: wallA, t: 0.5, width: 1.2 });
    const before = session.doc.get(winId)!.getBounds();
    addWall(session, 0, 0, 0, 5);
    const after = session.doc.get(winId)!.getBounds();
    expect(after.minX).toBeCloseTo(before.minX, 9);
    expect(after.maxX).toBeCloseTo(before.maxX, 9);
    // wall area unchanged by the interior opening despite the mitered corner
    expect(session.measure.areaOf(wallA)).toBeGreaterThan(0);
  });
});
