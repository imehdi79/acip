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
  /** derived from the relation graph — the graph is the single source of truth */
  readonly hostRef: RelationId | null;
  evalPlacement(anchor: Anchor, params: PlacementParams): Placement;
}

export interface ILevelAware {
  baseLevelId: LevelId | null;
  vertical: { height: number } | { topLevelId: LevelId };
}

export interface IMeshable {
  toMesh(detail: MeshDetail): Mesh3D;
}

/**
 * A hosted entity that cuts an opening in its host (window, door).
 * Dimensions along the host's anchor curve, in host-local terms.
 */
export interface OpeningSpec {
  /** normalized position of the opening center along the anchor (0..1) */
  readonly t: number;
  /** opening width in world units */
  readonly width: number;
  /** bottom of the opening above the host's base */
  readonly sill: number;
  /** vertical extent of the opening */
  readonly height: number;
}

export interface IOpeningCutter {
  getOpeningSpec(): OpeningSpec;
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

export function cutsOpening(e: Entity): e is Entity & IOpeningCutter {
  return typeof (e as Partial<IOpeningCutter>).getOpeningSpec === 'function';
}
