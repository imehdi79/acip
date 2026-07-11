import type { MaterialId, TypeId } from '../../common/id.js';
import { newTypeId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { RecordTable } from '../store.js';

export interface AssemblyLayer {
  readonly materialId: MaterialId;
  readonly thickness: number;
}

/**
 * Type catalog entry (Revit-style family type). A WallType's layers describe
 * its build-up; instances reference it via Entity.typeRef.
 */
export interface EntityTypeDef {
  readonly id: TypeId;
  /** which entity type this def applies to, e.g. 'wall' */
  readonly targetType: string;
  name: string;
  layers?: AssemblyLayer[];
  props?: JsonObject;
}

export class TypeCatalog extends RecordTable<EntityTypeDef> {
  add(def: Omit<EntityTypeDef, 'id'> & { id?: TypeId }): EntityTypeDef {
    const d: EntityTypeDef = { ...def, id: def.id ?? newTypeId() };
    this.set(d);
    return d;
  }

  override list(targetType?: string): EntityTypeDef[] {
    const all = super.list();
    return targetType ? all.filter((d) => d.targetType === targetType) : all;
  }
}
