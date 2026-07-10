import type { Point } from '../../geometry/primitives/point.js';
import type { EntityId } from '../../common/id.js';

export type SnapKind =
  | 'endpoint'
  | 'midpoint'
  | 'center'
  | 'node'
  | 'intersection'
  | 'perpendicular'
  | 'tangent'
  | 'nearest';

export interface SnapPoint {
  readonly kind: SnapKind;
  readonly point: Point;
  readonly entityId?: EntityId;
}
