import type { EntityId, MaterialId } from '../common/id.js';
import type { DrawingDocument } from '../document/document.js';
import type { MaterialUnit } from '../document/materials/index.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
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

export interface MaterialQuantity {
  readonly materialId: MaterialId;
  readonly name: string;
  readonly unit: MaterialUnit;
  readonly volume: number;
}

export interface QuantityReport {
  readonly walls: readonly WallQuantity[];
  readonly totals: {
    readonly wallLength: number;
    readonly wallNetFaceArea: number;
    readonly wallNetVolume: number;
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
  const materialVolumes = new Map<MaterialId, number>();
  let windowCount = 0;
  let doorCount = 0;

  for (const entity of doc.all()) {
    if (entity instanceof WindowEntity) windowCount += 1;
    if (entity instanceof DoorEntity) doorCount += 1;
    if (!(entity instanceof WallEntity)) continue;

    const q = wallQuantity(entity);
    walls.push(q);

    // split the wall's net volume across its assembly layers, proportional
    // to layer thickness — openings cut through every layer alike
    const typeDef = entity.typeRef ? doc.types.get(entity.typeRef) : null;
    if (typeDef?.layers && typeDef.layers.length > 0) {
      const total = typeDef.layers.reduce((s, l) => s + l.thickness, 0);
      if (total > 0) {
        for (const layer of typeDef.layers) {
          const share = q.netVolume * (layer.thickness / total);
          materialVolumes.set(
            layer.materialId,
            (materialVolumes.get(layer.materialId) ?? 0) + share,
          );
        }
      }
    }
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
    totals: {
      wallLength: walls.reduce((s, w) => s + w.length, 0),
      wallNetFaceArea: walls.reduce((s, w) => s + w.netFaceArea, 0),
      wallNetVolume: walls.reduce((s, w) => s + w.netVolume, 0),
      windowCount,
      doorCount,
    },
    materials,
  };
}
