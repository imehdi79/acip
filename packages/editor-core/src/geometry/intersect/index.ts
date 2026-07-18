import type { Point } from '../primitives/point.js';
import { cross, sub } from '../primitives/point.js';
import { EPSILON } from '../../common/tolerance.js';
import type { Geometry, SegmentShape } from '../shapes.js';

/**
 * Central pairwise intersection dispatcher. Relationships BETWEEN geometry
 * kinds live here, never as methods on entities (avoids N×N double dispatch).
 */
export type IntersectFn = (a: Geometry, b: Geometry) => Point[];

const table = new Map<string, { fn: IntersectFn; flipped: boolean }>();

const key = (a: string, b: string): string => `${a}|${b}`;

export function registerIntersection(
  kindA: string,
  kindB: string,
  fn: IntersectFn,
): void {
  table.set(key(kindA, kindB), { fn, flipped: false });
  if (kindA !== kindB) table.set(key(kindB, kindA), { fn, flipped: true });
}

export function intersect(a: Geometry, b: Geometry): Point[] {
  const entry = table.get(key(a.kind, b.kind));
  if (!entry) return [];
  return entry.flipped ? entry.fn(b, a) : entry.fn(a, b);
}

function segmentSegment(g1: Geometry, g2: Geometry): Point[] {
  const s1 = g1 as SegmentShape;
  const s2 = g2 as SegmentShape;
  const r = sub(s1.b, s1.a);
  const s = sub(s2.b, s2.a);
  const denom = cross(r, s);
  if (Math.abs(denom) < EPSILON) return [];
  const qp = sub(s2.a, s1.a);
  const t = cross(qp, s) / denom;
  const u = cross(qp, r) / denom;
  if (t < -EPSILON || t > 1 + EPSILON || u < -EPSILON || u > 1 + EPSILON)
    return [];
  return [{ x: s1.a.x + t * r.x, y: s1.a.y + t * r.y }];
}

registerIntersection('segment', 'segment', segmentSegment);
