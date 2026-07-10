import type { Point } from '../../geometry/primitives/point.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import type { LevelId, RelationId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import type { Entity } from './entity.js';

/** Where attachments may connect on a host (a wall's centerline, its faces…). */
export interface Anchor {
  readonly kind: 'curve' | 'face' | 'point';
  readonly geometry: Geometry;
  readonly name?: string;
}

export type PlacementParams = JsonObject;

export interface Placement {
  readonly position: Point;
  readonly rotation: number;
}

export interface IHost {
  getAnchors(): Anchor[];
}

export interface IHosted {
  hostRef: RelationId | null;
  evalPlacement(anchor: Anchor, params: PlacementParams): Placement;
}

export interface ILevelAware {
  baseLevelId: LevelId | null;
  vertical: { height: number } | { topLevelId: LevelId };
}

export interface IMeshable {
  toMesh(detail: MeshDetail): Mesh3D;
}

export function isHost(e: Entity): e is Entity & IHost {
  return typeof (e as Partial<IHost>).getAnchors === 'function';
}

export function isHosted(e: Entity): e is Entity & IHosted {
  return typeof (e as Partial<IHosted>).evalPlacement === 'function';
}

export function isLevelAware(e: Entity): e is Entity & ILevelAware {
  return 'baseLevelId' in e && 'vertical' in e;
}

export function isMeshable(e: Entity): e is Entity & IMeshable {
  return typeof (e as Partial<IMeshable>).toMesh === 'function';
}
