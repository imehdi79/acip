import type { JsonObject, JsonValue } from '../common/json.js';
import type { DrawingDocument } from '../document/document.js';
import { computeQuantities } from '../measurements/quantities.js';

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
    levels: doc.levels.list().map((l) => ({ id: l.id, name: l.name, elevation: l.elevation })),
    layers: doc.layersList().map((l) => ({
      id: l.id,
      name: l.name,
      visible: l.visible,
      locked: l.locked,
      ...(l.color ? { color: l.color } : {}),
    })),
    materials: doc.materials.list().map((m) => ({ id: m.id, name: m.name, unit: m.unit })),
    types: doc.types.list().map((t) => ({
      id: t.id,
      targetType: t.targetType,
      name: t.name,
      layers: (t.layers ?? []).map((layer) => ({
        materialId: layer.materialId,
        thickness: layer.thickness,
      })),
    })),
    entities: all.slice(0, maxEntities).map((e) => e.saveData() as unknown as JsonObject),
    relations: doc.relations.all().map((r) => ({ hostId: r.hostId, hostedId: r.hostedId })),
    quantities: {
      wallLength: quantities.totals.wallLength,
      wallNetFaceArea: quantities.totals.wallNetFaceArea,
      wallNetVolume: quantities.totals.wallNetVolume,
      windowCount: quantities.totals.windowCount,
      doorCount: quantities.totals.doorCount,
    },
  };
  if (all.length > maxEntities) digest['entitiesTruncated'] = all.length - maxEntities;
  return digest;
}
