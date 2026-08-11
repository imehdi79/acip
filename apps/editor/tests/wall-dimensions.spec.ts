import { describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import { wallDimensions, wallExtent } from '@/editor/viewport/wall-dimensions';

/**
 * Wall dimensions measure the OVERALL EXTENT: the wall as drawn, outer corner
 * to outer corner along its own axis. The anchors and the printed value come
 * from the same two points, so the line can never span a different length than
 * the label claims.
 */

const PLAN: ViewDefinition = { kind: 'plan', levelId: null };

function session(): EditorSession {
  return new EditorSession();
}

function wall(
  s: EditorSession,
  a: Point,
  b: Point,
  thickness = 0.3,
): WallEntity {
  const id = s.dispatch<EntityId>('WALL.ADD', { a, b, thickness, height: 3 });
  return s.doc.get(id) as WallEntity;
}

/** closed loop through the corners, so every wall is mitered at both ends */
function loop(
  s: EditorSession,
  corners: Point[],
  thickness = 0.3,
): WallEntity[] {
  return corners.map((a, i) =>
    wall(s, a, corners[(i + 1) % corners.length], thickness),
  );
}

/** the dimension's own anchors, as a length — must equal the reported length */
const spanOf = (d: { a: Point; b: Point }) =>
  Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);

describe('wallExtent', () => {
  it('measures a free-standing wall at its centreline length', () => {
    const s = session();
    // butt caps: nothing extends past the endpoints, so thickness cannot matter
    const dim = wallExtent(wall(s, point(0, 0), point(4, 0)));
    expect(dim?.length).toBeCloseTo(4, 6);
  });

  it('reaches the outer corners of a mitered horizontal wall', () => {
    const s = session();
    const [bottom] = loop(s, [
      point(0, 0),
      point(4, 0),
      point(4, 4),
      point(0, 4),
    ]);
    const dim = wallExtent(bottom);
    // 4 m centreline + half a thickness of miter at each end
    expect(dim?.length).toBeCloseTo(4.3, 6);
    expect(dim?.a.x).toBeCloseTo(-0.15, 6);
    expect(dim?.b.x).toBeCloseTo(4.15, 6);
    expect(dim?.a.y).toBeCloseTo(0, 6);
    expect(dim?.b.y).toBeCloseTo(0, 6);
  });

  it('does the same for a vertical wall', () => {
    const s = session();
    const [, right] = loop(s, [
      point(0, 0),
      point(4, 0),
      point(4, 4),
      point(0, 4),
    ]);
    const dim = wallExtent(right);
    expect(dim?.length).toBeCloseTo(4.3, 6);
    expect(dim?.a.x).toBeCloseTo(4, 6);
    expect(dim?.b.x).toBeCloseTo(4, 6);
    // anchors stay on the wall's own axis, extended past both endpoints
    expect(Math.min(dim!.a.y, dim!.b.y)).toBeCloseTo(-0.15, 6);
    expect(Math.max(dim!.a.y, dim!.b.y)).toBeCloseTo(4.15, 6);
  });

  it('keeps angled walls on their own axis', () => {
    const s = session();
    const [diagonal] = loop(s, [point(0, 0), point(3, 4), point(0, 8)]);
    const dim = wallExtent(diagonal)!;
    expect(dim).not.toBeNull();

    // the anchors must be collinear with the baseline, not axis-aligned
    const { a, b } = diagonal.getBaseline();
    const ux = (b.x - a.x) / 5;
    const uy = (b.y - a.y) / 5;
    for (const p of [dim.a, dim.b]) {
      const cross = (p.x - a.x) * uy - (p.y - a.y) * ux;
      expect(cross).toBeCloseTo(0, 9);
    }
    // and it spans at least the centreline (5-3-4 triangle)
    expect(dim.length).toBeGreaterThanOrEqual(5 - 1e-9);
  });

  it('scales the miter with wall thickness', () => {
    const thin = session();
    const thick = session();
    const square = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    const a = wallExtent(loop(thin, square, 0.2)[0])!;
    const b = wallExtent(loop(thick, square, 0.6)[0])!;
    expect(a.length).toBeCloseTo(4.2, 6);
    expect(b.length).toBeCloseTo(4.6, 6);
  });

  it('tracks wall length independently of the miter', () => {
    const s = session();
    const [bottom] = loop(s, [
      point(0, 0),
      point(7.5, 0),
      point(7.5, 3),
      point(0, 3),
    ]);
    expect(wallExtent(bottom)?.length).toBeCloseTo(7.8, 6);
  });

  it('reports a length that matches its own anchors, always', () => {
    const s = session();
    const walls = [
      ...loop(s, [point(0, 0), point(4, 0), point(4, 4), point(0, 4)]),
      wall(s, point(10, 0), point(13, 4)), // free-standing, angled
    ];
    for (const w of walls) {
      const dim = wallExtent(w)!;
      expect(dim).not.toBeNull();
      // the invariant the whole fix exists to guarantee
      expect(spanOf(dim)).toBeCloseTo(dim.length, 9);
    }
  });

  it('is unaffected by an opening, even one reaching a wall end', () => {
    const s = session();
    const [bottom] = loop(s, [
      point(0, 0),
      point(4, 0),
      point(4, 4),
      point(0, 4),
    ]);
    const before = wallExtent(bottom)!.length;
    // a 1 m window centred at t=1 runs off the end of the wall
    s.dispatch('WINDOW.ADD', { wallId: bottom.id, t: 1, width: 1 });
    expect(wallExtent(bottom)!.length).toBeCloseTo(before, 6);
  });

  it('returns null for a degenerate wall', () => {
    const s = session();
    expect(wallExtent(wall(s, point(2, 2), point(2, 2)))).toBeNull();
  });
});

describe('wallDimensions', () => {
  it('gives one dimension per distinct span on the plan', () => {
    const s = session();
    loop(s, [point(0, 0), point(4, 0), point(4, 4), point(0, 4)]);
    const dims = wallDimensions(s.doc, PLAN);
    // a square room measures the same 4.3 four times over; the opposite edges
    // are duplicates of each other, so one of each pair is enough
    expect(dims.length).toBe(2);
    for (const d of dims) expect(d.length).toBeCloseTo(4.3, 6);
  });

  it('draws nothing in 3D', () => {
    const s = session();
    loop(s, [point(0, 0), point(4, 0), point(4, 4), point(0, 4)]);
    expect(wallDimensions(s.doc, { kind: '3d' } as ViewDefinition)).toEqual([]);
  });
});
