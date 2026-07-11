import type { MaterialId } from '../../common/id.js';
import { newMaterialId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { RecordTable } from '../store.js';

export type MaterialUnit = 'm' | 'm2' | 'm3' | 'count';

/**
 * A material is one thing seen three ways: hatch in plan, appearance in 3D,
 * cost basis to the estimator.
 */
export interface Material {
  readonly id: MaterialId;
  name: string;
  unit: MaterialUnit;
  hatch?: string;
  appearance?: JsonObject;
}

export class MaterialLibrary extends RecordTable<Material> {
  add(material: Omit<Material, 'id'> & { id?: MaterialId }): Material {
    const m: Material = { ...material, id: material.id ?? newMaterialId() };
    this.set(m);
    return m;
  }
}
