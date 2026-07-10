/**
 * 2.5D derivation output: meshes generated from 2D footprints + vertical data.
 * See docs/editor-core/04-systems/2-5d-strategy.md. Extrusion/triangulation
 * functions land here when the first IMeshable entity needs them.
 */
export type MeshDetail = 'low' | 'medium' | 'high';

export interface Mesh3D {
  /** flat xyz triples */
  readonly positions: readonly number[];
  /** triangle vertex indices */
  readonly indices: readonly number[];
}
