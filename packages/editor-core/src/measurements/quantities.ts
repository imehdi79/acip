import type { EntityId, MaterialId, TypeId } from '../common/id.js';
import type { DrawingDocument } from '../document/document.js';
import type { MaterialUnit } from '../document/materials/index.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { SlabEntity } from '../entities/architecture/slab-entity.js';
import { RoofEntity } from '../entities/architecture/roof-entity.js';
import { WindowEntity } from '../entities/architecture/window-entity.js';
import { DoorEntity } from '../entities/architecture/door-entity.js';

/**
 * Quantity takeoff — the estimator seed. Everything here reads EFFECTIVE
 * state: openings are already deducted, assembly layers come from the type
 * catalog. packages/estimator will consume and extend this with measurement
 * rules and cost rates.
 */
export interface WallQuantity {
  readonly entityId: EntityId;
  readonly length: number;
  /** elevation face area: length × height − opening cuts */
  readonly netFaceArea: number;
  /** solid volume: gross − opening volumes */
  readonly netVolume: number;
  readonly openings: number;
}

export interface SlabQuantity {
  readonly entityId: EntityId;
  /** footprint area */
  readonly area: number;
  /** area × assembly thickness */
  readonly volume: number;
}

export interface RoofQuantity {
  readonly entityId: EntityId;
  readonly planArea: number;
  /** sloped surface area — what roofing trades price */
  readonly slopeArea: number;
  /** plan area × vertical thickness */
  readonly volume: number;
}

export interface MaterialQuantity {
  readonly materialId: MaterialId;
  readonly name: string;
  readonly unit: MaterialUnit;
  readonly volume: number;
}

export interface QuantityReport {
  readonly walls: readonly WallQuantity[];
  readonly slabs: readonly SlabQuantity[];
  readonly roofs: readonly RoofQuantity[];
  readonly totals: {
    readonly wallLength: number;
    readonly wallNetFaceArea: number;
    readonly wallNetVolume: number;
    readonly slabArea: number;
    readonly slabVolume: number;
    readonly roofSlopeArea: number;
    readonly roofVolume: number;
    readonly windowCount: number;
    readonly doorCount: number;
  };
  readonly materials: readonly MaterialQuantity[];
}

function wallQuantity(wall: WallEntity): WallQuantity {
  const length = wall.getLength();
  const height = wall.getHeight();
  const thickness = wall.getThickness();
  const specs = wall.getOpeningSpecs();

  let faceCut = 0;
  let volumeCut = 0;
  for (const spec of specs) {
    const start = Math.max(0, spec.t * length - spec.width / 2);
    const end = Math.min(length, spec.t * length + spec.width / 2);
    const width = Math.max(0, end - start);
    const openingHeight = Math.min(spec.height, height - spec.sill);
    faceCut += width * openingHeight;
    volumeCut += width * thickness * openingHeight;
  }

  return {
    entityId: wall.id,
    length,
    netFaceArea: Math.max(0, length * height - faceCut),
    netVolume: Math.max(0, length * thickness * height - volumeCut),
    openings: specs.length,
  };
}

export function computeQuantities(doc: DrawingDocument): QuantityReport {
  const walls: WallQuantity[] = [];
  const slabs: SlabQuantity[] = [];
  const roofs: RoofQuantity[] = [];
  const materialVolumes = new Map<MaterialId, number>();
  let windowCount = 0;
  let doorCount = 0;

  // split a net volume across the type's assembly layers, proportional to
  // layer thickness (for walls: openings cut through every layer alike;
  // for slabs the layers ARE a vertical stack, so the split is exact)
  const splitAcrossLayers = (typeRef: TypeId | undefined, netVolume: number): void => {
    const typeDef = typeRef ? doc.types.get(typeRef) : null;
    if (!typeDef?.layers || typeDef.layers.length === 0) return;
    const total = typeDef.layers.reduce((s, l) => s + l.thickness, 0);
    if (total <= 0) return;
    for (const layer of typeDef.layers) {
      const share = netVolume * (layer.thickness / total);
      materialVolumes.set(layer.materialId, (materialVolumes.get(layer.materialId) ?? 0) + share);
    }
  };

  for (const entity of doc.all()) {
    if (entity instanceof WindowEntity) windowCount += 1;
    if (entity instanceof DoorEntity) doorCount += 1;
    if (entity instanceof SlabEntity) {
      const area = entity.getArea();
      const q: SlabQuantity = { entityId: entity.id, area, volume: area * entity.getThickness() };
      slabs.push(q);
      splitAcrossLayers(entity.typeRef, q.volume);
      continue;
    }
    if (entity instanceof RoofEntity) {
      const q: RoofQuantity = {
        entityId: entity.id,
        planArea: entity.getPlanArea(),
        slopeArea: entity.getSlopeArea(),
        volume: entity.getPlanArea() * entity.getThickness(),
      };
      roofs.push(q);
      splitAcrossLayers(entity.typeRef, q.volume);
      continue;
    }
    if (!(entity instanceof WallEntity)) continue;

    const q = wallQuantity(entity);
    walls.push(q);
    splitAcrossLayers(entity.typeRef, q.netVolume);
  }

  const materials: MaterialQuantity[] = [];
  for (const [materialId, volume] of materialVolumes) {
    const material = doc.materials.get(materialId);
    materials.push({
      materialId,
      name: material?.name ?? materialId,
      unit: material?.unit ?? 'm3',
      volume,
    });
  }
  materials.sort((a, b) => b.volume - a.volume);

  return {
    walls,
    slabs,
    roofs,
    totals: {
      wallLength: walls.reduce((s, w) => s + w.length, 0),
      wallNetFaceArea: walls.reduce((s, w) => s + w.netFaceArea, 0),
      wallNetVolume: walls.reduce((s, w) => s + w.netVolume, 0),
      slabArea: slabs.reduce((s, q) => s + q.area, 0),
      slabVolume: slabs.reduce((s, q) => s + q.volume, 0),
      roofSlopeArea: roofs.reduce((s, q) => s + q.slopeArea, 0),
      roofVolume: roofs.reduce((s, q) => s + q.volume, 0),
      windowCount,
      doorCount,
    },
    materials,
  };
}
