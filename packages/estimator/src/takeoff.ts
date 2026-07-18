import {
  FinishEntity,
  RoofEntity,
  SlabEntity,
  StairEntity,
  WallEntity,
} from '@acip/editor-core';
import type {
  DrawingDocument,
  EntityId,
  MaterialUnit,
  TypeId,
} from '@acip/editor-core';

/**
 * Geometric FACTS extracted through the SDK — no measurement policy here.
 * Rules (policy) decide which deductions count; boq.ts turns the result
 * into priced lines. Walls and slabs; finishes join later.
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
  /** m² per count unit (tile face area); undefined for m/m²/m³ */
  readonly coverage?: number;
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

export interface SlabTakeoff {
  readonly entityId: EntityId;
  readonly area: number;
  readonly thickness: number;
  readonly volume: number;
  /** footprint perimeter — reference length for edge (m) materials */
  readonly perimeter: number;
  /** resolved assembly; empty when the slab has no type */
  readonly layers: readonly AssemblyLayerFact[];
}

function resolveLayers(
  doc: DrawingDocument,
  typeRef: TypeId | undefined,
): AssemblyLayerFact[] {
  const layers: AssemblyLayerFact[] = [];
  if (!typeRef) return layers;
  const def = doc.types.get(typeRef);
  for (const layer of def?.layers ?? []) {
    const material = doc.materials.get(layer.materialId);
    if (!material) continue;
    const fact: AssemblyLayerFact = {
      materialId: layer.materialId,
      name: material.name,
      unit: material.unit,
      costCode: material.costCode ?? material.name,
      thickness: layer.thickness,
    };
    layers.push(
      material.coverage !== undefined
        ? { ...fact, coverage: material.coverage }
        : fact,
    );
  }
  return layers;
}

export function computeSlabTakeoff(doc: DrawingDocument): SlabTakeoff[] {
  const result: SlabTakeoff[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof SlabEntity)) continue;
    const area = entity.getArea();
    const thickness = entity.getThickness();
    result.push({
      entityId: entity.id,
      area,
      thickness,
      volume: area * thickness,
      perimeter: entity.getPerimeter(),
      layers: resolveLayers(doc, entity.typeRef),
    });
  }
  return result;
}

export interface RoofTakeoff {
  readonly entityId: EntityId;
  readonly planArea: number;
  /** sloped surface area — what roofing trades price */
  readonly slopeArea: number;
  readonly thickness: number;
  readonly volume: number;
  /** plan-footprint perimeter — reference length for edge (m) materials */
  readonly perimeter: number;
  /** resolved assembly; empty when the roof has no type */
  readonly layers: readonly AssemblyLayerFact[];
}

export function computeRoofTakeoff(doc: DrawingDocument): RoofTakeoff[] {
  const result: RoofTakeoff[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof RoofEntity)) continue;
    const planArea = entity.getPlanArea();
    const thickness = entity.getThickness();
    result.push({
      entityId: entity.id,
      planArea,
      slopeArea: entity.getSlopeArea(),
      thickness,
      volume: planArea * thickness,
      perimeter: entity.getPerimeter(),
      layers: resolveLayers(doc, entity.typeRef),
    });
  }
  return result;
}

export interface FinishTakeoff {
  readonly entityId: EntityId;
  /** finished band area minus overlapping openings */
  readonly area: number;
  /** covered length along the wall — reference for m materials */
  readonly length: number;
  readonly thickness: number;
  /** the single applied material, resolved as a layer fact; null if unset/missing */
  readonly layer: AssemblyLayerFact | null;
}

export function computeFinishTakeoff(doc: DrawingDocument): FinishTakeoff[] {
  const result: FinishTakeoff[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof FinishEntity)) continue;
    let layer: AssemblyLayerFact | null = null;
    if (entity.materialId) {
      const material = doc.materials.get(entity.materialId);
      if (material) {
        const fact: AssemblyLayerFact = {
          materialId: entity.materialId,
          name: material.name,
          unit: material.unit,
          costCode: material.costCode ?? material.name,
          thickness: entity.getThickness(),
        };
        layer =
          material.coverage !== undefined
            ? { ...fact, coverage: material.coverage }
            : fact;
      }
    }
    result.push({
      entityId: entity.id,
      area: entity.getNetArea(),
      length: entity.getCoveredLength(),
      thickness: entity.getThickness(),
      layer,
    });
  }
  return result;
}

export interface StairTakeoff {
  readonly entityId: EntityId;
  readonly rise: number;
  readonly riserCount: number;
}

export function computeStairTakeoff(doc: DrawingDocument): StairTakeoff[] {
  const result: StairTakeoff[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof StairEntity)) continue;
    result.push({
      entityId: entity.id,
      rise: entity.getRise(),
      riserCount: entity.getRiserCount(),
    });
  }
  return result;
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
      deductions.push({
        area: width * openingHeight,
        volume: width * thickness * openingHeight,
      });
    }

    result.push({
      entityId: entity.id,
      length,
      height,
      thickness,
      grossVolume: length * height * thickness,
      deductions,
      layers: resolveLayers(doc, entity.typeRef),
    });
  }
  return result;
}
