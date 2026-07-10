import type { LayerId } from '../common/id.js';
import type { EntityData } from '../entities/base/data.js';
import type { Layer } from '../document/layer.js';
import { DEFAULT_LAYER_ID } from '../document/layer.js';
import type { Level } from '../document/levels/index.js';
import type { Material } from '../document/materials/index.js';
import type { EntityTypeDef } from '../document/types/index.js';
import type { Relation } from '../relations/types.js';
import { DrawingDocument } from '../document/document.js';
import type { EntityTypeRegistry } from '../registry/entity-registry.js';

/** Native persistence format. DXF/IFC importers map into this same shape. */
export interface DocumentData {
  readonly formatVersion: 1;
  readonly layers: readonly Layer[];
  readonly levels: readonly Level[];
  readonly materials: readonly Material[];
  readonly types: readonly EntityTypeDef[];
  readonly entities: readonly EntityData[];
  readonly relations: readonly Relation[];
}

export function saveDocument(doc: DrawingDocument): DocumentData {
  return {
    formatVersion: 1,
    layers: doc.layersList(),
    levels: doc.levels.list(),
    materials: doc.materials.list(),
    types: doc.types.list(),
    entities: doc.all().map((e) => e.saveData()),
    relations: doc.relations.all(),
  };
}

export function loadDocument(data: DocumentData, registry: EntityTypeRegistry): DrawingDocument {
  const doc = new DrawingDocument();
  for (const layer of data.layers) {
    if ((layer.id as LayerId) === DEFAULT_LAYER_ID) continue;
    doc.addLayer({ ...layer });
  }
  for (const level of data.levels) {
    doc.levels.add(level.name, level.elevation, level.id);
  }
  for (const material of data.materials) {
    doc.materials.add({ ...material });
  }
  for (const typeDef of data.types) {
    doc.types.add({ ...typeDef });
  }
  for (const entityData of data.entities) {
    doc._insert(registry.restore(entityData));
  }
  for (const relation of data.relations) {
    doc.relations.restore(relation);
  }
  return doc;
}
