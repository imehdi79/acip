import { describe, expect, test } from 'bun:test';
import { recognizeWalls, simplifyStroke } from '../src/index.js';
import type { Point, WallSegment } from '../src/index.js';

/** noisy samples along a straight line from a to b */
function jitterLine(a: Point, b: Point, n: number, jitter: number): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    // deterministic wobble so the test is stable
    const w = Math.sin(i * 2.3) * jitter;
    pts.push({
      x: a.x + (b.x - a.x) * t - (b.y - a.y) * t * 0 + w,
      y: a.y + (b.y - a.y) * t + w,
    });
  }
  return pts;
}

const isAxisAligned = (s: WallSegment): boolean =>
  Math.abs(s.a.x - s.b.x) < 1e-6 || Math.abs(s.a.y - s.b.y) < 1e-6;

describe('simplifyStroke', () => {
  test('collapses a densely sampled straight line to its endpoints', () => {
    const pts = jitterLine({ x: 0, y: 0 }, { x: 5, y: 0 }, 40, 0.01);
    const out = simplifyStroke(pts, 0.15);
    expect(out.length).toBe(2);
    // endpoints are preserved verbatim (jitter and all), only the run collapses
    expect(out[0].x).toBeCloseTo(0, 1);
    expect(out[out.length - 1].x).toBeCloseTo(5, 1);
  });

  test('keeps a genuine corner', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 1 },
      { x: 2, y: 2 },
    ];
    const out = simplifyStroke(pts, 0.1);
    expect(out).toEqual([
      { x: 0, y: 0 },
      { x: 2, y: 0 },
      { x: 2, y: 2 },
    ]);
  });

  test('leaves short strokes untouched', () => {
    const pts = [
      { x: 0, y: 0 },
      { x: 1, y: 1 },
    ];
    expect(simplifyStroke(pts, 0.1)).toEqual(pts);
  });
});

describe('recognizeWalls', () => {
  test('turns a hand-drawn rectangle into four clean axis-aligned walls', () => {
    // one wobbly closed loop roughly tracing a 5 × 4 rectangle
    const loop = [
      ...jitterLine({ x: 0, y: 0 }, { x: 5, y: 0 }, 20, 0.08),
      ...jitterLine({ x: 5, y: 0 }, { x: 5, y: 4 }, 16, 0.08),
      ...jitterLine({ x: 5, y: 4 }, { x: 0, y: 4 }, 20, 0.08),
      ...jitterLine({ x: 0, y: 4 }, { x: 0, y: 0 }, 16, 0.08),
    ];
    const walls = recognizeWalls([loop]);
    expect(walls.length).toBe(4);
    for (const w of walls) expect(isAxisAligned(w)).toBe(true);

    // corners snapped onto exactly two X and two Y gridlines
    const xs = new Set(
      walls.flatMap((w) => [w.a.x, w.b.x].map((n) => Math.round(n))),
    );
    const ys = new Set(
      walls.flatMap((w) => [w.a.y, w.b.y].map((n) => Math.round(n))),
    );
    expect(xs).toEqual(new Set([0, 5]));
    expect(ys).toEqual(new Set([0, 4]));
  });

  test('shares exact corner coordinates so consecutive walls join', () => {
    const stroke = [
      { x: 0, y: 0 },
      { x: 2.98, y: 0.02 },
      { x: 3.01, y: 2.0 },
    ];
    const walls = recognizeWalls([stroke], { minLength: 0.2 });
    expect(walls.length).toBe(2);
    // the second wall's start equals the first wall's end (welded corner)
    expect(walls[0].b).toEqual(walls[1].a);
  });

  test('straightens a slightly tilted line to an exact axis', () => {
    // ~9° off horizontal — a shaky hand, meant to be straight
    const stroke = [
      { x: 0, y: 0 },
      { x: 4, y: 0.65 },
    ];
    const walls = recognizeWalls([stroke]);
    expect(walls.length).toBe(1);
    expect(walls[0].a.y).toBeCloseTo(walls[0].b.y, 6); // perfectly horizontal
  });

  test('a bellied line stays a single wall, not several collinear pieces', () => {
    // a "straight" horizontal line drawn with a bow in the middle
    const stroke = [
      { x: 0, y: 0 },
      { x: 1, y: 0.18 },
      { x: 2, y: 0.24 },
      { x: 3, y: 0.18 },
      { x: 4, y: 0 },
    ];
    const walls = recognizeWalls([stroke]);
    expect(walls.length).toBe(1);
    expect(walls[0].a.y).toBeCloseTo(walls[0].b.y, 6); // and straightened
  });

  test('keeps a clearly diagonal line at its drawn slope', () => {
    // ~45° — an intentional diagonal wall
    const stroke = [
      { x: 0, y: 0 },
      { x: 3, y: 3 },
    ];
    const walls = recognizeWalls([stroke]);
    expect(walls.length).toBe(1);
    expect(Math.abs(walls[0].a.y - walls[0].b.y)).toBeGreaterThan(1); // not flattened
    expect(Math.abs(walls[0].a.x - walls[0].b.x)).toBeGreaterThan(1);
  });

  test('drops stray flicks below minLength', () => {
    const stroke = [
      { x: 0, y: 0 },
      { x: 0.05, y: 0 },
    ];
    expect(recognizeWalls([stroke])).toEqual([]);
  });

  test('returns nothing for empty input', () => {
    expect(recognizeWalls([])).toEqual([]);
    expect(recognizeWalls([[{ x: 1, y: 1 }]])).toEqual([]);
  });
});

/**
 * Squaring only ever reaches corners drawn as two DIAGONALS. Straightening
 * makes any corner between two axis-classified legs exactly 90° already, and a
 * leg within 5° of perpendicular to an axis leg classifies to that
 * perpendicular axis itself (5 is well inside `axisSnapDegrees`). Verified by
 * sweeping every pair of drawn leg angles through `recognizeWalls`: of the
 * corners that came out near 90° but not exactly 90°, every single one had two
 * diagonal legs.
 *
 * A consequence worth knowing when reading these tests: at the default 35°
 * axis bias, two diagonals can only meet between 70° and 110° (or nearly
 * head-on, under 20°). Angles in between are unreachable — one leg would have
 * classified to an axis — which is why the "left alone" case below is drawn at
 * 80°, and the 70° case has to relax the bias to keep both legs diagonal.
 */
describe('recognizeWalls — square corners', () => {
  const rad = (d: number) => (d * Math.PI) / 180;

  /** a two-leg corner at the origin, each leg drawn toward `deg` for `len` */
  const corner = (deg1: number, deg2: number, len = 3): Point[] => [
    { x: len * Math.cos(rad(deg1)), y: len * Math.sin(rad(deg1)) },
    { x: 0, y: 0 },
    { x: len * Math.cos(rad(deg2)), y: len * Math.sin(rad(deg2)) },
  ];

  /** the angle at the corner the two walls share, in degrees */
  const cornerAngle = (walls: WallSegment[]): number => {
    const [w1, w2] = walls;
    const same = (p: Point, q: Point) =>
      Math.abs(p.x - q.x) < 1e-9 && Math.abs(p.y - q.y) < 1e-9;
    const at = [w1.a, w1.b].find((p) => same(p, w2.a) || same(p, w2.b))!;
    const f1 = same(w1.a, at) ? w1.b : w1.a;
    const f2 = same(w2.a, at) ? w2.b : w2.a;
    const ux = f1.x - at.x;
    const uy = f1.y - at.y;
    const vx = f2.x - at.x;
    const vy = f2.y - at.y;
    return (
      (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) /
      Math.PI
    );
  };

  const length = (w: WallSegment) => Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y);

  test('a corner drawn at 93° comes back at exactly 90°', () => {
    const walls = recognizeWalls([corner(46.5, -46.5)]);
    expect(walls.length).toBe(2);
    expect(cornerAngle(walls)).toBeCloseTo(90, 9);
    // the legs turned about the corner, so neither grew or shrank
    for (const w of walls) expect(length(w)).toBeCloseTo(3, 9);
  });

  test('a corner drawn at 87° comes back at exactly 90°', () => {
    const walls = recognizeWalls([corner(43.5, -43.5)]);
    expect(walls.length).toBe(2);
    expect(cornerAngle(walls)).toBeCloseTo(90, 9);
  });

  test('a corner really drawn at a slant is left at its slant', () => {
    // 80° — ten degrees out is a decision, not a wobble
    const walls = recognizeWalls([corner(40, -40)]);
    expect(walls.length).toBe(2);
    expect(cornerAngle(walls)).toBeCloseTo(80, 9);
  });

  test('a corner drawn at 70° stays 70°', () => {
    // both legs have to stay diagonal for the squaring rule to see the corner
    // at all, and at the default 35° axis bias a 70° corner cannot have two —
    // one leg would be forced onto an axis. So the bias is relaxed here, which
    // isolates what this test is about: the 5° window, and nothing else.
    const walls = recognizeWalls([corner(45, 115)], { axisSnapDegrees: 20 });
    expect(walls.length).toBe(2);
    expect(cornerAngle(walls)).toBeCloseTo(70, 9);
  });

  test('the window is a window: 84° is left, 86° is squared', () => {
    expect(cornerAngle(recognizeWalls([corner(42, -42)]))).toBeCloseTo(84, 9);
    expect(cornerAngle(recognizeWalls([corner(43, -43)]))).toBeCloseTo(90, 9);
  });

  test('squareDegrees: 0 leaves every corner exactly as drawn', () => {
    const walls = recognizeWalls([corner(46.5, -46.5)], { squareDegrees: 0 });
    expect(cornerAngle(walls)).toBeCloseTo(93, 9);
  });

  test('a closed hand-drawn loop stays closed', () => {
    // a room drawn on the diagonal: four diagonal legs, corners a few degrees
    // off square (93.5°, 85.8°, 90.7°), and not one endpoint free. Squaring any
    // of them would drag a node another wall is standing on, so squaring
    // declines — a corner is not worth pulling the room apart.
    const drawn = [
      { x: 0, y: 0 },
      { x: 4.3, y: 3.8 },
      { x: 0, y: 8 },
      { x: -4, y: 4 },
      { x: 0, y: 0 },
    ];
    const walls = recognizeWalls([drawn]);
    expect(walls.length).toBe(4);

    // every endpoint is shared with exactly one other wall: the loop is closed
    const key = (p: Point) =>
      `${Math.round(p.x * 1e9)}:${Math.round(p.y * 1e9)}`;
    const uses = new Map<string, number>();
    for (const w of walls)
      for (const p of [w.a, w.b]) uses.set(key(p), (uses.get(key(p)) ?? 0) + 1);
    expect(uses.size).toBe(4);
    for (const n of uses.values()) expect(n).toBe(2);

    // and it is closed because nothing moved, not because the moves cancelled
    const at = (p: Point) =>
      walls.filter((w) =>
        [w.a, w.b].some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-9),
      );
    expect(cornerAngle(at({ x: 0, y: 0 }))).toBeCloseTo(93.5, 1);
    expect(cornerAngle(at({ x: 4.3, y: 3.8 }))).toBeCloseTo(85.8, 1);
  });

  test('turns the free leg, and never the one another wall stands on', () => {
    const legs = corner(46.5, -46.5);
    const far = legs[2]; // the end of the second leg
    const walls = recognizeWalls([
      legs,
      // a second stroke hanging off that end, pinning it in place
      [far, { x: far.x + 3, y: far.y }],
    ]);
    expect(walls.length).toBe(3);

    const pinned = walls.find(
      (w) => Math.abs(w.b.x - w.a.x) > 2.5 && Math.abs(w.b.y - w.a.y) < 1e-9,
    );
    expect(pinned).toBeDefined();
    // the pinned end did not move, so the two strokes still share their corner
    const corner93 = walls.filter((w) => w !== pinned);
    expect(cornerAngle(corner93)).toBeCloseTo(90, 9);
    const touching = corner93.find((w) =>
      [w.a, w.b].some(
        (p) => Math.abs(p.x - far.x) < 1e-9 && Math.abs(p.y - far.y) < 1e-9,
      ),
    );
    expect(touching).toBeDefined();
  });
});
