import type { JsonObject, JsonValue } from '../common/json.js';
import type { LevelId } from '../common/id.js';
import type { DrawingDocument } from '../document/document.js';
import { computeQuantities } from '../measurements/quantities.js';
import { detectSpaces } from '../measurements/spaces.js';

export interface DescribeDocumentOptions {
  /** entity cap so huge drawings stay inside an LLM context (default 200) */
  maxEntities?: number;
}

/**
 * LLM-legible digest of the document: catalogs, entities (their saveData
 * envelope — the persisted truth, nothing derived), host relations, and the
 * quantity totals. This is the "Reads" half of the agent contract; commands
 * are the "Acts" half.
 */
export function describeDocument(
  doc: DrawingDocument,
  options: DescribeDocumentOptions = {},
): JsonObject {
  const maxEntities = options.maxEntities ?? 200;
  const all = doc.all();

  const byType: Record<string, number> = {};
  for (const entity of all) {
    byType[entity.type] = (byType[entity.type] ?? 0) + 1;
  }

  const quantities = computeQuantities(doc);

  const digest: Record<string, JsonValue> = {
    counts: { entities: all.length, byType },
    levels: doc.levels
      .list()
      .map((l) => ({ id: l.id, name: l.name, elevation: l.elevation })),
    layers: doc.layersList().map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      ...(l.color ? { color: l.color } : {}),
    })),
    materials: doc.materials
      .list()
      .map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    types: doc.types.list().map((t) => ({
      id: t.id,
      targetType: t.targetType,
      name: t.name,
      layers: (t.layers ?? []).map((layer) => ({
        materialId: layer.materialId,
        thickness: layer.thickness,
      })),
    })),
    entities: all
      .slice(0, maxEntities)
      .map((e) => e.saveData() as unknown as JsonObject),
    relations: doc.relations
      .all()
      .map((r) => ({ hostId: r.hostId, hostedId: r.hostedId })),
    // detected rooms make the drawing ADDRESSABLE ("the 14 m² room on L1")
    // for a few tokens each — far cheaper than reasoning over wall envelopes
    spaces: spacesDigest(doc),
    quantities: {
      wallLength: quantities.totals.wallLength,
      wallNetFaceArea: quantities.totals.wallNetFaceArea,
      wallNetVolume: quantities.totals.wallNetVolume,
      slabArea: quantities.totals.slabArea,
      slabVolume: quantities.totals.slabVolume,
      roofSlopeArea: quantities.totals.roofSlopeArea,
      roofVolume: quantities.totals.roofVolume,
      finishArea: quantities.totals.finishArea,
      stairCount: quantities.totals.stairCount,
      windowCount: quantities.totals.windowCount,
      doorCount: quantities.totals.doorCount,
    },
  };
  if (all.length > maxEntities)
    digest['entitiesTruncated'] = all.length - maxEntities;
  return digest;
}

/** one entry per detected room, per level (the scopes plan views use) */
function spacesDigest(doc: DrawingDocument): JsonValue[] {
  const levels = doc.levels.list();
  const scopes: (LevelId | null)[] =
    levels.length > 0 ? levels.map((l) => l.id) : [null];
  const round = (v: number): number => Math.round(v * 100) / 100;
  const out: JsonValue[] = [];
  for (const scope of scopes) {
    for (const space of detectSpaces(doc, scope)) {
      out.push({
        key: space.key,
        level: scope,
        netArea: round(space.netArea),
        grossArea: round(space.grossArea),
        walls: space.boundaryWallIds as unknown as string[],
      });
    }
  }
  return out;
}
