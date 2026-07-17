import type { EntityId, MaterialId, TypeId } from '../common/id.js';
import type { DrawingDocument } from '../document/document.js';
import type { MaterialUnit } from '../document/materials/index.js';
import type { LayerRefs } from './layer-quantity.js';
import { layerQuantity } from './layer-quantity.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { SlabEntity } from '../entities/architecture/slab-entity.js';
import { RoofEntity } from '../entities/architecture/roof-entity.js';
import { FinishEntity } from '../entities/architecture/finish-entity.js';
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

export interface FinishQuantity {
  readonly entityId: EntityId;
  readonly materialId: MaterialId | null;
  /** finished band area minus overlapping openings */
  readonly netArea: number;
}

export interface MaterialQuantity {
  readonly materialId: MaterialId;
  readonly name: string;
  readonly unit: MaterialUnit;
  /** in the material's own unit — volume for m³, area for m², count for tiles */
  readonly quantity: number;
}

export interface QuantityReport {
  readonly walls: readonly WallQuantity[];
  readonly slabs: readonly SlabQuantity[];
  readonly roofs: readonly RoofQuantity[];
  readonly finishes: readonly FinishQuantity[];
  readonly totals: {
    readonly wallLength: number;
    readonly wallNetFaceArea: number;
    readonly wallNetVolume: number;
    readonly slabArea: number;
    readonly slabVolume: number;
    readonly roofSlopeArea: number;
    readonly roofVolume: number;
    readonly finishArea: number;
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
  const finishes: FinishQuantity[] = [];
  const materialQuantities = new Map<MaterialId, number>();
  let windowCount = 0;
  let doorCount = 0;

  const addMaterial = (materialId: MaterialId, quantity: number): void => {
    materialQuantities.set(materialId, (materialQuantities.get(materialId) ?? 0) + quantity);
  };

  // split an element across its assembly layers, each layer measured in its
  // material's own unit: m³ takes a thickness-proportional volume share, m²
  // the reference area, m the length, count the area over the tile coverage
  const splitAcrossLayers = (typeRef: TypeId | undefined, refs: LayerRefs): void => {
    const typeDef = typeRef ? doc.types.get(typeRef) : null;
    if (!typeDef?.layers || typeDef.layers.length === 0) return;
    const total = typeDef.layers.reduce((s, l) => s + l.thickness, 0);
    for (const layer of typeDef.layers) {
      const material = doc.materials.get(layer.materialId);
      const q = layerQuantity(material?.unit ?? 'm3', layer.thickness, total, refs, material?.coverage);
      addMaterial(layer.materialId, q);
    }
  };

  for (const entity of doc.all()) {
    if (entity instanceof WindowEntity) windowCount += 1;
    if (entity instanceof DoorEntity) doorCount += 1;
    if (entity instanceof FinishEntity) {
      const netArea = entity.getNetArea();
      finishes.push({ entityId: entity.id, materialId: entity.materialId, netArea });
      if (entity.materialId) {
        const material = doc.materials.get(entity.materialId);
        // a finish is a one-layer assembly on a face
        const q = layerQuantity(
          material?.unit ?? 'm2',
          entity.getThickness(),
          entity.getThickness(),
          { volume: netArea * entity.getThickness(), area: netArea, length: entity.getCoveredLength() },
          material?.coverage,
        );
        addMaterial(entity.materialId, q);
      }
      continue;
    }
    if (entity instanceof SlabEntity) {
      const area = entity.getArea();
      const q: SlabQuantity = { entityId: entity.id, area, volume: area * entity.getThickness() };
      slabs.push(q);
      splitAcrossLayers(entity.typeRef, { volume: q.volume, area, length: entity.getPerimeter() });
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
      splitAcrossLayers(entity.typeRef, {
        volume: q.volume,
        area: q.slopeArea,
        length: entity.getPerimeter(),
      });
      continue;
    }
    if (!(entity instanceof WallEntity)) continue;

    const q = wallQuantity(entity);
    walls.push(q);
    splitAcrossLayers(entity.typeRef, {
      volume: q.netVolume,
      area: q.netFaceArea,
      length: q.length,
    });
  }

  const materials: MaterialQuantity[] = [];
  for (const [materialId, quantity] of materialQuantities) {
    const material = doc.materials.get(materialId);
    materials.push({
      materialId,
      name: material?.name ?? materialId,
      unit: material?.unit ?? 'm3',
      quantity,
    });
  }
  materials.sort((a, b) => b.quantity - a.quantity);

  return {
    walls,
    slabs,
    roofs,
    finishes,
    totals: {
      wallLength: walls.reduce((s, w) => s + w.length, 0),
      wallNetFaceArea: walls.reduce((s, w) => s + w.netFaceArea, 0),
      wallNetVolume: walls.reduce((s, w) => s + w.netVolume, 0),
      slabArea: slabs.reduce((s, q) => s + q.area, 0),
      slabVolume: slabs.reduce((s, q) => s + q.volume, 0),
      roofSlopeArea: roofs.reduce((s, q) => s + q.slopeArea, 0),
      roofVolume: roofs.reduce((s, q) => s + q.volume, 0),
      finishArea: finishes.reduce((s, q) => s + q.netArea, 0),
      windowCount,
      doorCount,
    },
    materials,
  };
}
