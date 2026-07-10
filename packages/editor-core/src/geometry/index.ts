export * from './primitives/index.js';
export * from './curves/index.js';
export type {
  Geometry,
  SegmentShape,
  PolylineShape,
  CircleShape,
  ArcShape,
  RegionShape,
  GroupShape,
} from './shapes.js';
export { geometryBBox } from './shapes.js';
export type { IntersectFn } from './intersect/index.js';
export { intersect, registerIntersection } from './intersect/index.js';
export type { Mesh3D, MeshDetail } from './mesh/index.js';
