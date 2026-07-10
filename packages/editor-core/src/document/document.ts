import type { EntityId, LayerId } from '../common/id.js';
import { TypedEventEmitter } from '../common/events.js';
import { DocumentError } from '../common/errors.js';
import type { BBox } from '../geometry/primitives/bbox.js';
import type { Entity } from '../entities/base/entity.js';
import type { Layer } from './layer.js';
import { createDefaultLayer } from './layer.js';
import { LevelTable } from './levels/index.js';
import { MaterialLibrary } from './materials/index.js';
import { TypeCatalog } from './types/index.js';
import type { SpatialIndex } from './spatial/index.js';
import { NaiveSpatialIndex } from './spatial/index.js';
import { RelationGraph } from '../relations/relation-graph.js';
import type { CommitRecord } from './history/transaction.js';

export interface DocumentChangeEvent {
  readonly kind: 'commit' | 'undo' | 'redo';
  readonly record: CommitRecord;
  /** downstream entities invalidated via the relation graph */
  readonly dirty: readonly EntityId[];
}

export type DocumentEvents = {
  change: DocumentChangeEvent;
};

export class DrawingDocument {
  readonly events = new TypedEventEmitter<DocumentEvents>();
  readonly relations = new RelationGraph();
  readonly levels = new LevelTable();
  readonly materials = new MaterialLibrary();
  readonly types = new TypeCatalog();

  private entities = new Map<EntityId, Entity>();
  private layers = new Map<LayerId, Layer>();
  private spatial: SpatialIndex = new NaiveSpatialIndex();

  constructor() {
    const layer = createDefaultLayer();
    this.layers.set(layer.id, layer);
  }

  get(id: EntityId): Entity | null {
    return this.entities.get(id) ?? null;
  }

  has(id: EntityId): boolean {
    return this.entities.has(id);
  }

  get count(): number {
    return this.entities.size;
  }

  all(): Entity[] {
    return [...this.entities.values()];
  }

  queryBBox(area: BBox): Entity[] {
    const result: Entity[] = [];
    for (const id of this.spatial.query(area)) {
      const e = this.entities.get(id);
      if (e) result.push(e);
    }
    return result;
  }

  getLayer(id: LayerId): Layer | null {
    return this.layers.get(id) ?? null;
  }

  addLayer(layer: Layer): void {
    if (this.layers.has(layer.id)) {
      throw new DocumentError(`layer ${layer.id} already exists`);
    }
    this.layers.set(layer.id, layer);
  }

  layersList(): Layer[] {
    return [...this.layers.values()];
  }

  /** @internal mutation path for transactions/history only — use the command bus */
  _insert(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      throw new DocumentError(`entity ${entity.id} already in document`);
    }
    this.entities.set(entity.id, entity);
    entity._attachToDocument(this);
    this.spatial.insert(entity.id, entity.getBounds());
  }

  /** @internal mutation path for transactions/history only — use the command bus */
  _delete(id: EntityId): Entity {
    const entity = this.entities.get(id);
    if (!entity) throw new DocumentError(`entity ${id} not in document`);
    this.entities.delete(id);
    this.spatial.remove(id);
    entity._detachFromDocument();
    return entity;
  }

  /** @internal keeps the spatial index in sync after a registered mutation */
  _entityChanged(entity: Entity): void {
    this.spatial.update(entity.id, entity.getBounds());
  }

  /** @internal emitted once per committed/undone/redone transaction */
  _emitChange(kind: DocumentChangeEvent['kind'], record: CommitRecord): void {
    const touched: EntityId[] = [
      ...record.changes.created.map((d) => d.id as EntityId),
      ...record.changes.updated.map((u) => u.after.id as EntityId),
      ...record.changes.removed.map((d) => d.id as EntityId),
    ];
    const dirty = this.relations.collectDirty(touched);
    for (const id of dirty) {
      const e = this.entities.get(id);
      if (e) this.spatial.update(id, e.getBounds());
    }
    this.events.emit('change', { kind, record, dirty });
  }
}
