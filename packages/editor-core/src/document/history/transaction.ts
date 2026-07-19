import type { EntityId, RelationId } from '../../common/id.js';
import { TransactionError } from '../../common/errors.js';
import type { Entity } from '../../entities/base/entity.js';
import type { EntityData } from '../../entities/base/data.js';
import type { PlacementParams } from '../../entities/base/capabilities.js';
import type { Relation, RelationChange } from '../../relations/types.js';
import type { DrawingDocument, StoreName } from '../document.js';
import type { StoreItem } from '../store.js';

/** document-store edits (levels, layers, materials, types) — snapshot-based like entities */
export type StoreChange =
  | { readonly store: StoreName; readonly op: 'add'; readonly item: StoreItem }
  | {
      readonly store: StoreName;
      readonly op: 'update';
      readonly before: StoreItem;
      readonly after: StoreItem;
    }
  | {
      readonly store: StoreName;
      readonly op: 'remove';
      readonly item: StoreItem;
    };

/**
 * The immutable result of one committed command. History replays it for
 * undo/redo; the change event derived from it drives dirty propagation,
 * spatial-index updates, rendering, and estimator recompute; a stream of these
 * records is the future collaboration protocol.
 */
export interface CommitRecord {
  readonly commandName: string;
  readonly params: unknown;
  readonly changes: {
    readonly created: readonly EntityData[];
    readonly updated: readonly { before: EntityData; after: EntityData }[];
    readonly removed: readonly EntityData[];
    readonly relations: readonly RelationChange[];
    readonly stores: readonly StoreChange[];
  };
  readonly timestamp: number;
}

/**
 * All document mutations flow through this interface. Snapshot-based:
 * before-state is captured on first touch, after-state at commit — undo works
 * for every entity type ever registered, including ones from future packages.
 */
export interface Transaction {
  create(entity: Entity): void;
  update<E extends Entity>(entity: E, mutate: (draft: E) => void): void;
  remove(entity: Entity): void;
  attach(
    hostId: EntityId,
    hostedId: EntityId,
    anchorIndex: number,
    params: PlacementParams,
  ): Relation;
  detach(relationId: RelationId): void;
  storeAdd<T extends StoreItem>(store: StoreName, item: T): T;
  storeUpdate<T extends StoreItem>(
    store: StoreName,
    id: string,
    mutate: (draft: T) => void,
  ): void;
  storeRemove(store: StoreName, id: string): void;
}

export class TransactionImpl implements Transaction {
  private createdIds = new Set<EntityId>();
  private createdOrder: EntityId[] = [];
  private before = new Map<EntityId, EntityData>();
  private removedEntities = new Map<
    EntityId,
    { entity: Entity; data: EntityData }
  >();
  private relationOps: RelationChange[] = [];
  private storeOps: StoreChange[] = [];
  private closed = false;

  constructor(private doc: DrawingDocument) {}

  private assertOpen(): void {
    if (this.closed)
      throw new TransactionError('transaction is already closed');
  }

  create(entity: Entity): void {
    this.assertOpen();
    // fresh entities get the next per-type mark; restored/pasted data that
    // already carries one keeps it (undo snapshots must round-trip exactly)
    if (entity.mark === undefined) entity.mark = this.doc.nextMark(entity.type);
    this.doc._insert(entity);
    this.createdIds.add(entity.id);
    this.createdOrder.push(entity.id);
  }

  update<E extends Entity>(entity: E, mutate: (draft: E) => void): void {
    this.assertOpen();
    if (!this.doc.has(entity.id)) {
      throw new TransactionError(
        `cannot update entity ${entity.id}: not in document`,
      );
    }
    if (!this.createdIds.has(entity.id) && !this.before.has(entity.id)) {
      this.before.set(entity.id, entity.saveData());
    }
    mutate(entity);
    this.doc._entityChanged(entity);
  }

  remove(entity: Entity): void {
    this.assertOpen();
    // relations touching the entity are detached first, so graph stays consistent
    const attached = [
      ...this.doc.relations.relationsOfHost(entity.id),
      ...(this.doc.relations.relationOfHosted(entity.id)
        ? [this.doc.relations.relationOfHosted(entity.id) as Relation]
        : []),
    ];
    for (const rel of attached) this.detach(rel.id);

    if (this.createdIds.has(entity.id)) {
      // created and removed in the same transaction: net effect is nothing
      this.doc._delete(entity.id);
      this.createdIds.delete(entity.id);
      this.createdOrder = this.createdOrder.filter((id) => id !== entity.id);
      return;
    }
    const snapshot = this.before.get(entity.id) ?? entity.saveData();
    this.before.delete(entity.id);
    this.doc._delete(entity.id);
    this.removedEntities.set(entity.id, { entity, data: snapshot });
  }

  attach(
    hostId: EntityId,
    hostedId: EntityId,
    anchorIndex: number,
    params: PlacementParams,
  ): Relation {
    this.assertOpen();
    const relation = this.doc.relations.attach(
      hostId,
      hostedId,
      anchorIndex,
      params,
    );
    this.relationOps.push({ op: 'attach', relation });
    return relation;
  }

  detach(relationId: RelationId): void {
    this.assertOpen();
    const relation = this.doc.relations.detach(relationId);
    this.relationOps.push({ op: 'detach', relation });
  }

  storeAdd<T extends StoreItem>(store: StoreName, item: T): T {
    this.assertOpen();
    const table = this.doc._store(store);
    if (table.has(item.id)) {
      throw new TransactionError(`${store} item ${item.id} already exists`);
    }
    table.set(structuredClone(item));
    this.storeOps.push({ store, op: 'add', item: structuredClone(item) });
    return item;
  }

  storeUpdate<T extends StoreItem>(
    store: StoreName,
    id: string,
    mutate: (draft: T) => void,
  ): void {
    this.assertOpen();
    const table = this.doc._store(store);
    const current = table.get(id);
    if (!current)
      throw new TransactionError(`${store} item ${id} does not exist`);
    const before = structuredClone(current);
    const draft = structuredClone(current) as T;
    mutate(draft);
    table.set(draft);
    this.storeOps.push({
      store,
      op: 'update',
      before,
      after: structuredClone(draft),
    });
  }

  storeRemove(store: StoreName, id: string): void {
    this.assertOpen();
    const table = this.doc._store(store);
    const current = table.get(id);
    if (!current)
      throw new TransactionError(`${store} item ${id} does not exist`);
    table.delete(id);
    this.storeOps.push({ store, op: 'remove', item: structuredClone(current) });
  }

  commit(commandName: string, params: unknown): CommitRecord {
    this.assertOpen();
    this.closed = true;
    const created: EntityData[] = [];
    for (const id of this.createdOrder) {
      const e = this.doc.get(id);
      if (e) created.push(e.saveData());
    }
    const updated: { before: EntityData; after: EntityData }[] = [];
    for (const [id, beforeData] of this.before) {
      const e = this.doc.get(id);
      if (e) updated.push({ before: beforeData, after: e.saveData() });
    }
    const removed = [...this.removedEntities.values()].map((r) => r.data);
    return {
      commandName,
      params,
      changes: {
        created,
        updated,
        removed,
        relations: [...this.relationOps],
        stores: [...this.storeOps],
      },
      timestamp: Date.now(),
    };
  }

  rollback(): void {
    this.assertOpen();
    this.closed = true;
    // reverse store ops first — entities may reference their items
    for (let i = this.storeOps.length - 1; i >= 0; i--) {
      const op = this.storeOps[i];
      const table = this.doc._store(op.store);
      if (op.op === 'add') table.delete(op.item.id);
      else if (op.op === 'update') table.set(op.before);
      else table.set(op.item);
    }
    // reverse relation ops next (they may reference created/removed entities)
    for (let i = this.relationOps.length - 1; i >= 0; i--) {
      const op = this.relationOps[i];
      if (op.op === 'attach') this.doc.relations.detach(op.relation.id);
      else this.doc.relations.restore(op.relation);
    }
    for (const id of [...this.createdOrder].reverse()) {
      this.doc._delete(id);
    }
    for (const { entity, data } of this.removedEntities.values()) {
      this.doc._insert(entity);
      entity.loadData(data);
      this.doc._entityChanged(entity);
    }
    for (const [id, beforeData] of this.before) {
      const e = this.doc.get(id);
      if (e) {
        e.loadData(beforeData);
        this.doc._entityChanged(e);
      }
    }
  }
}
