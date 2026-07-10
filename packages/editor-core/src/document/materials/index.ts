import type { MaterialId } from '../../common/id.js';
import { newMaterialId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';

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

export class MaterialLibrary {
  private materials = new Map<MaterialId, Material>();

  add(material: Omit<Material, 'id'> & { id?: MaterialId }): Material {
    const m: Material = { ...material, id: material.id ?? newMaterialId() };
    this.materials.set(m.id, m);
    return m;
  }

  get(id: MaterialId): Material | null {
    return this.materials.get(id) ?? null;
  }

  list(): Material[] {
    return [...this.materials.values()];
  }
}
