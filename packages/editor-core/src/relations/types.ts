import type { EntityId, RelationId } from '../common/id.js';
import type { PlacementParams } from '../entities/base/capabilities.js';

/**
 * One-directional host→hosted dependency: "window #7 on wall #42, anchor 0,
 * at t=0.4". World placement of the hosted entity is DERIVED, never stored.
 */
export interface Relation {
  readonly id: RelationId;
  readonly hostId: EntityId;
  readonly hostedId: EntityId;
  readonly anchorIndex: number;
  readonly params: PlacementParams;
}

export type RelationChange =
  | { readonly op: 'attach'; readonly relation: Relation }
  | { readonly op: 'detach'; readonly relation: Relation };
