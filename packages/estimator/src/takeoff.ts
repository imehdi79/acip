import { WallEntity } from '@acip/editor-core';
import type { DrawingDocument, EntityId, MaterialUnit } from '@acip/editor-core';

/**
 * Geometric FACTS extracted through the SDK — no measurement policy here.
 * Rules (policy) decide which deductions count; boq.ts turns the result
 * into priced lines. Walls only for now; slabs/finishes join later.
 */
export interface OpeningDeduction {
  /** elevation face area of the opening (m²) */
  readonly area: number;
  /** wall volume the opening displaces (m³) */
  readonly volume: number;
}

export interface AssemblyLayerFact {
  readonly materialId: string;
  readonly name: string;
  readonly unit: MaterialUnit;
  readonly costCode: string;
  readonly thickness: number;
}

export interface WallTakeoff {
  readonly entityId: EntityId;
  readonly length: number;
  readonly height: number;
  readonly thickness: number;
  readonly grossVolume: number;
  readonly deductions: readonly OpeningDeduction[];
  /** resolved assembly, outermost first; empty when the wall has no type */
  readonly layers: readonly AssemblyLayerFact[];
}

export function computeWallTakeoff(doc: DrawingDocument): WallTakeoff[] {
  const result: WallTakeoff[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof WallEntity)) continue;
    const length = entity.getLength();
    const height = entity.getHeight();
    const thickness = entity.getThickness();

    const deductions: OpeningDeduction[] = [];
    for (const spec of entity.getOpeningSpecs()) {
      const start = Math.max(0, spec.t * length - spec.width / 2);
      const end = Math.min(length, spec.t * length + spec.width / 2);
      const width = Math.max(0, end - start);
      const openingHeight = Math.min(spec.height, height - spec.sill);
      deductions.push({ area: width * openingHeight, volume: width * thickness * openingHeight });
    }

    const layers: AssemblyLayerFact[] = [];
    if (entity.typeRef) {
      const def = doc.types.get(entity.typeRef);
      for (const layer of def?.layers ?? []) {
        const material = doc.materials.get(layer.materialId);
        if (!material) continue;
        layers.push({
          materialId: layer.materialId,
          name: material.name,
          unit: material.unit,
          costCode: material.costCode ?? material.name,
          thickness: layer.thickness,
        });
      }
    }

    result.push({
      entityId: entity.id,
      length,
      height,
      thickness,
      grossVolume: length * height * thickness,
      deductions,
      layers,
    });
  }
  return result;
}
