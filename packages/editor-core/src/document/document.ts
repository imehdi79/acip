import type { EntityId, LayerId, LevelId } from '../common/id.js';
import { TypedEventEmitter } from '../common/events.js';
import { DocumentError } from '../common/errors.js';
import type { BBox } from '../geometry/primitives/bbox.js';
import type { Entity } from '../entities/base/entity.js';
import { isLevelAware } from '../entities/base/capabilities.js';
import type { Layer } from './layer.js';
import { LayerTable, createDefaultLayer } from './layer.js';
import { LevelTable } from './levels/index.js';
import { MaterialLibrary } from './materials/index.js';
import { TypeCatalog } from './types/index.js';
import type { MutableStore, StoreItem } from './store.js';
import type { SpatialIndex } from './spatial/index.js';
import { NaiveSpatialIndex } from './spatial/index.js';
import { RelationGraph } from '../relations/relation-graph.js';
import type { CommitRecord } from './history/transaction.js';

export type StoreName = 'layers' | 'levels' | 'materials' | 'types';

export interface DocumentChangeEvent {
  readonly kind: 'commit' | 'undo' | 'redo' | 'load';
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
  readonly layers = new LayerTable();
  readonly levels = new LevelTable();
  readonly materials = new MaterialLibrary();
  readonly types = new TypeCatalog();

  private entities = new Map<EntityId, Entity>();
  private spatial: SpatialIndex = new NaiveSpatialIndex();
  /** highest mark seen per type — derived from entities, maintained on insert */
  private markCounters = new Map<string, number>();

  constructor() {
    this.layers.set(createDefaultLayer());
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
    return this.layers.get(id);
  }

  layersList(): Layer[] {
    return this.layers.list();
  }

  /** @internal uniform store access for transactions/history */
  _store(name: StoreName): MutableStore<StoreItem> {
    switch (name) {
      case 'layers':
        return this.layers;
      case 'levels':
        return this.levels;
      case 'materials':
        return this.materials;
      case 'types':
        return this.types;
    }
  }

  /**
   * Next per-type mark ("wall 3"). Reserves the number immediately; marks are
   * never reused within a session, so a deleted wall's number stays retired
   * and conversation references ("wall 3") never silently change referent.
   */
  nextMark(type: string): number {
    const next = (this.markCounters.get(type) ?? 0) + 1;
    this.markCounters.set(type, next);
    return next;
  }

  /** entity with the given per-type mark, or null (the "wall 3" lookup) */
  byMark(type: string, mark: number): Entity | null {
    for (const entity of this.entities.values()) {
      if (entity.type === type && entity.mark === mark) return entity;
    }
    return null;
  }

  /** @internal mutation path for transactions/history only — use the command bus */
  _insert(entity: Entity): void {
    if (this.entities.has(entity.id)) {
      throw new DocumentError(`entity ${entity.id} already in document`);
    }
    this.entities.set(entity.id, entity);
    entity._attachToDocument(this);
    this.spatial.insert(entity.id, entity.getBounds());
    // loads and redo insert pre-marked entities — keep the counter ahead
    if (
      entity.mark !== undefined &&
      entity.mark > (this.markCounters.get(entity.type) ?? 0)
    ) {
      this.markCounters.set(entity.type, entity.mark);
    }
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

  /**
   * @internal wipe everything for open/new. Callers (EditorSession.open)
   * must clear history and selection themselves, then _emitLoad() once the
   * new content is in place.
   */
  _reset(): void {
    for (const entity of this.entities.values()) {
      entity._detachFromDocument();
    }
    this.entities.clear();
    this.spatial = new NaiveSpatialIndex();
    this.markCounters.clear();
    this.relations._clear();
    for (const store of [
      this.layers,
      this.levels,
      this.materials,
      this.types,
    ]) {
      for (const item of store.list()) store.delete(item.id);
    }
    this.layers.set(createDefaultLayer());
  }

  /** @internal one whole-document event after open/new — everything re-reads */
  _emitLoad(): void {
    this.events.emit('change', {
      kind: 'load',
      record: {
        commandName: 'DOC.LOAD',
        params: null,
        changes: {
          created: [],
          updated: [],
          removed: [],
          relations: [],
          stores: [],
        },
        timestamp: Date.now(),
      },
      dirty: [],
    });
  }

  /** @internal emitted once per committed/undone/redone transaction */
  _emitChange(kind: DocumentChangeEvent['kind'], record: CommitRecord): void {
    const touched: EntityId[] = [
      ...record.changes.created.map((d) => d.id as EntityId),
      ...record.changes.updated.map((u) => u.after.id as EntityId),
      ...record.changes.removed.map((d) => d.id as EntityId),
    ];
    // relation edits change derived geometry on both ends (a window snaps to
    // its wall on attach) — both endpoints count as touched
    for (const op of record.changes.relations) {
      touched.push(op.relation.hostId, op.relation.hostedId);
    }
    // a level's elevation change invalidates every entity bound to it;
    // a type's assembly change invalidates every entity referencing it
    // (derived thickness changes geometry and bounds)
    const changedLevels = new Set<string>();
    const changedTypes = new Set<string>();
    for (const change of record.changes.stores) {
      if (change.store !== 'levels' && change.store !== 'types') continue;
      const id = change.op === 'update' ? change.after.id : change.item.id;
      if (change.store === 'levels') changedLevels.add(id);
      else changedTypes.add(id);
    }
    // store-invalidated entities need their spatial entries refreshed
    // themselves (a type's thickness change widens wall bounds) — direct
    // entity updates are already synced by the transaction
    const storeInvalidated: EntityId[] = [];
    if (changedLevels.size > 0 || changedTypes.size > 0) {
      // a level-aware entity is bound to a changed level as its base OR its
      // top (a stair spans two levels — the cross-level relation)
      const boundToChangedLevel = (entity: Entity): boolean => {
        if (!isLevelAware(entity)) return false;
        if (
          entity.baseLevelId &&
          changedLevels.has(entity.baseLevelId as LevelId as string)
        ) {
          return true;
        }
        const v = entity.vertical;
        return (
          'topLevelId' in v &&
          changedLevels.has(v.topLevelId as LevelId as string)
        );
      };
      for (const entity of this.entities.values()) {
        if (boundToChangedLevel(entity)) {
          storeInvalidated.push(entity.id);
        } else if (
          entity.typeRef &&
          changedTypes.has(entity.typeRef as string)
        ) {
          storeInvalidated.push(entity.id);
        }
      }
      touched.push(...storeInvalidated);
    }
    // store-invalidated entities (level/type changes) are themselves dirty —
    // their derived geometry changed but they carry no record entry, so a
    // consumer reading record + dirty would otherwise miss them
    const dirty = [
      ...new Set([
        ...storeInvalidated,
        ...this.relations.collectDirty(touched),
      ]),
    ];
    for (const id of dirty) {
      const e = this.entities.get(id);
      if (e) this.spatial.update(id, e.getBounds());
    }
    this.events.emit('change', { kind, record, dirty });
  }
}
