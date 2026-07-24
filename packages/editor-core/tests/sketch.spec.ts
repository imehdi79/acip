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
    const xs = new Set(walls.flatMap((w) => [w.a.x, w.b.x].map((n) => Math.round(n))));
    const ys = new Set(walls.flatMap((w) => [w.a.y, w.b.y].map((n) => Math.round(n))));
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
