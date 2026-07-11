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
