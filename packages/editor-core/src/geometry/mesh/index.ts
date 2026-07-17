import type { Point } from '../primitives/point.js';

/**
 * 2.5D derivation output: meshes generated from 2D footprints + vertical data.
 * See docs/editor-core/04-systems/2-5d-strategy.md.
 */
export type MeshDetail = 'low' | 'medium' | 'high';

export interface Mesh3D {
  /** flat xyz triples */
  readonly positions: readonly number[];
  /** triangle vertex indices */
  readonly indices: readonly number[];
}

export const EMPTY_MESH: Mesh3D = { positions: [], indices: [] };

/** extrude a plan quad (4 corners, in order) from z0 to z1 — a closed box */
export function extrudeQuad(quad: readonly [Point, Point, Point, Point], z0: number, z1: number): Mesh3D {
  const positions: number[] = [];
  for (const p of quad) positions.push(p.x, p.y, z0);
  for (const p of quad) positions.push(p.x, p.y, z1);
  // bottom ring 0-3, top ring 4-7
  const indices: number[] = [
    // sides
    0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5,
    2, 3, 7, 2, 7, 6,
    3, 0, 4, 3, 4, 7,
    // bottom + top
    0, 2, 1, 0, 3, 2,
    4, 5, 6, 4, 6, 7,
  ];
  return { positions, indices };
}

export function mergeMeshes(meshes: readonly Mesh3D[]): Mesh3D {
  const positions: number[] = [];
  const indices: number[] = [];
  let offset = 0;
  for (const mesh of meshes) {
    positions.push(...mesh.positions);
    for (const i of mesh.indices) indices.push(i + offset);
    offset += mesh.positions.length / 3;
  }
  return { positions, indices };
}

function cross2(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

function pointInTriangle(p: Point, a: Point, b: Point, c: Point): boolean {
  const d1 = cross2(a, b, p);
  const d2 = cross2(b, c, p);
  const d3 = cross2(c, a, p);
  const eps = 1e-12;
  return d1 >= -eps && d2 >= -eps && d3 >= -eps;
}

/**
 * Ear-clipping triangulation of a simple polygon (either winding, no holes).
 * Returns index triples into `points`, wound counter-clockwise in plan.
 * Handles the concave footprints rooms actually have (L-shapes, notches).
 */
export function triangulateLoop(points: readonly Point[]): number[] {
  const n = points.length;
  if (n < 3) return [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    const q = points[(i + 1) % n];
    area += p.x * q.y - q.x * p.y;
  }
  const idx = [...Array(n).keys()];
  if (area < 0) idx.reverse();

  const triangles: number[] = [];
  while (idx.length > 3) {
    let clipped = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i - 1 + idx.length) % idx.length];
      const ib = idx[i];
      const ic = idx[(i + 1) % idx.length];
      const a = points[ia];
      const b = points[ib];
      const c = points[ic];
      if (cross2(a, b, c) <= 1e-12) continue; // reflex or collinear — not an ear
      let blocked = false;
      for (const j of idx) {
        if (j === ia || j === ib || j === ic) continue;
        if (pointInTriangle(points[j], a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      triangles.push(ia, ib, ic);
      idx.splice(i, 1);
      clipped = true;
      break;
    }
    if (!clipped) break; // degenerate input — return what we have
  }
  if (idx.length === 3) triangles.push(idx[0], idx[1], idx[2]);
  return triangles;
}

/**
 * Loft a simple polygon between two rings of per-vertex heights:
 * triangulated caps plus one side quad per edge. Sloped bodies (roofs,
 * later ramps) use varying rings; `extrudePolygon` is the constant case.
 */
export function loftPolygon(
  points: readonly Point[],
  zBottom: readonly number[],
  zTop: readonly number[],
): Mesh3D {
  const n = points.length;
  if (zBottom.length !== n || zTop.length !== n) return EMPTY_MESH;
  const caps = triangulateLoop(points);
  if (caps.length === 0) return EMPTY_MESH;
  const positions: number[] = [];
  for (let i = 0; i < n; i++) positions.push(points[i].x, points[i].y, zBottom[i]);
  for (let i = 0; i < n; i++) positions.push(points[i].x, points[i].y, zTop[i]);
  const indices: number[] = [];
  // bottom cap faces down (reversed), top cap faces up
  for (let i = 0; i < caps.length; i += 3) {
    indices.push(caps[i], caps[i + 2], caps[i + 1]);
    indices.push(caps[i] + n, caps[i + 1] + n, caps[i + 2] + n);
  }
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    indices.push(i, j, j + n, i, j + n, i + n);
  }
  return { positions, indices };
}

/**
 * Extrude a simple polygon footprint from z0 to z1. The `extrudeQuad`
 * generalization footprint entities (slabs) use — walls keep the cheaper
 * quad path.
 */
export function extrudePolygon(points: readonly Point[], z0: number, z1: number): Mesh3D {
  return loftPolygon(
    points,
    points.map(() => z0),
    points.map(() => z1),
  );
}
