import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  point,
  resolveJunction,
  resolveTeeCap,
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

describe('resolveTeeCap — pure butt math', () => {
  // continuous wall along x-axis, near face y = H
  const facePoint = point(0, H);
  const faceDir = point(1, 0);

  test('perpendicular tee butts flush against the face', () => {
    const cap = resolveTeeCap(
      { point: point(2, 0), direction: point(0, 1), halfWidth: H },
      facePoint,
      faceDir,
    );
    expectPoint(cap!.left, 2 - H, H);
    expectPoint(cap!.right, 2 + H, H);
  });

  test('angled tee bevels along the face', () => {
    const s = Math.SQRT1_2;
    const cap = resolveTeeCap(
      { point: point(2, 0), direction: point(s, s), halfWidth: H },
      facePoint,
      faceDir,
    );
    // both corners land on the face line, offset asymmetrically
    expect(cap!.left.y).toBeCloseTo(H, 9);
    expect(cap!.right.y).toBeCloseTo(H, 9);
    expect(cap!.left.x).not.toBeCloseTo(cap!.right.x, 9);
  });

  test('parallel wall cannot butt — returns null', () => {
    const cap = resolveTeeCap(
      { point: point(2, 0), direction: point(1, 0), halfWidth: H },
      facePoint,
      faceDir,
    );
    expect(cap).toBeNull();
  });

  test('shallow incidence is clamped to the miter limit', () => {
    const deg5 = (5 * Math.PI) / 180;
    const cap = resolveTeeCap(
      { point: point(2, 0), direction: point(Math.cos(deg5), Math.sin(deg5)), halfWidth: H },
      facePoint,
      faceDir,
    );
    expect(Math.hypot(cap!.left.x - 2, cap!.left.y)).toBeLessThanOrEqual(8 * H + 1e-9);
    expect(Math.hypot(cap!.right.x - 2, cap!.right.y)).toBeLessThanOrEqual(8 * H + 1e-9);
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

  test('wall ending on another wall interior butts against the near face', () => {
    const session = new EditorSession();
    const host = addWall(session, 0, 0, 10, 0);
    const tee = addWall(session, 5, 0, 5, 3); // endpoint on host's centerline

    // tee's plan stops at the host's near face y = H
    const teeBounds = boundaryOf(session, tee);
    expect(hasCorner(teeBounds, 5 - H, H)).toBe(true);
    expect(hasCorner(teeBounds, 5 + H, H)).toBe(true);
    expect(hasCorner(teeBounds, 5 - H, 0)).toBe(false);
    // clipped back: area is (3 − H) × 0.3
    expect(session.measure.areaOf(tee)).toBeCloseTo((3 - H) * 0.3, 9);

    // the continuous wall is untouched — still a plain 4-corner rectangle
    const hostBounds = boundaryOf(session, host);
    expect(hostBounds.length).toBe(4);
    expect(hasCorner(hostBounds, 0, H)).toBe(true);
    expect(hasCorner(hostBounds, 10, -H)).toBe(true);
  });

  test('tee mesh stops at the host face', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 10, 0);
    const tee = addWall(session, 5, 0, 5, 3);
    const mesh = (session.doc.get(tee) as WallEntity).toMesh('medium');
    for (let i = 1; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(H - 1e-9);
    }
  });

  test('endpoint snapped to the host face joins flush without clipping', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 10, 0);
    const tee = addWall(session, 5, H, 5, 3); // starts exactly on the face
    const bounds = boundaryOf(session, tee);
    expect(hasCorner(bounds, 5 - H, H)).toBe(true);
    expect(hasCorner(bounds, 5 + H, H)).toBe(true);
    expect(session.measure.areaOf(tee)).toBeCloseTo((3 - H) * 0.3, 9);
  });

  test('shortening the host past the tee point dissolves the join', () => {
    const session = new EditorSession();
    const host = addWall(session, 0, 0, 10, 0);
    const tee = addWall(session, 5, 0, 5, 3);
    session.dispatch('GRIP.MOVE', { id: host, index: 1, to: point(3, 0) });
    const bounds = boundaryOf(session, tee);
    expect(hasCorner(bounds, 5 - H, 0)).toBe(true); // square cap again
    expect(hasCorner(bounds, 5 - H, H)).toBe(false);
  });

  test('shared-endpoint wheel wins over a tee candidate', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 10, 0); // host body under the junction
    const wallA = addWall(session, 5, 0, 5, 3);
    const wallB = addWall(session, 5, 0, 8, 3); // shares (5,0) with wallA
    // both walls miter against each other (wheel), not butt against the host
    const boundsA = boundaryOf(session, wallA);
    const boundsB = boundaryOf(session, wallB);
    expect(hasCorner(boundsA, 5 - H, H)).toBe(false); // not the tee butt corner
    for (const p of [...boundsA, ...boundsB]) {
      expect(Number.isFinite(p.x)).toBe(true);
      expect(Number.isFinite(p.y)).toBe(true);
    }
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
