import type { JsonObject } from '../../common/json.js';

/**
 * JSON-safe persisted form of an entity. Invariant: anything NOT representable
 * here is derived state and must be recomputable (powers snapshot undo,
 * serialization, IFC export, collaboration).
 */
export interface EntityData {
  readonly id: string;
  readonly type: string;
  readonly layerId: string;
  readonly typeRef?: string;
  /** schema version of the entity type's props format */
  readonly version: number;
  readonly props: JsonObject;
}
