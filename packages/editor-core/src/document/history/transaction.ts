import type { EntityId, RelationId } from '../../common/id.js';
import { TransactionError } from '../../common/errors.js';
import type { Entity } from '../../entities/base/entity.js';
import type { EntityData } from '../../entities/base/data.js';
import type { PlacementParams } from '../../entities/base/capabilities.js';
import type { Relation, RelationChange } from '../../relations/types.js';
import type { DrawingDocument } from '../document.js';

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
}

export class TransactionImpl implements Transaction {
  private createdIds = new Set<EntityId>();
  private createdOrder: EntityId[] = [];
  private before = new Map<EntityId, EntityData>();
  private removedEntities = new Map<EntityId, { entity: Entity; data: EntityData }>();
  private relationOps: RelationChange[] = [];
  private closed = false;

  constructor(private doc: DrawingDocument) {}

  private assertOpen(): void {
    if (this.closed) throw new TransactionError('transaction is already closed');
  }

  create(entity: Entity): void {
    this.assertOpen();
    this.doc._insert(entity);
    this.createdIds.add(entity.id);
    this.createdOrder.push(entity.id);
  }

  update<E extends Entity>(entity: E, mutate: (draft: E) => void): void {
    this.assertOpen();
    if (!this.doc.has(entity.id)) {
      throw new TransactionError(`cannot update entity ${entity.id}: not in document`);
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
    const relation = this.doc.relations.attach(hostId, hostedId, anchorIndex, params);
    this.relationOps.push({ op: 'attach', relation });
    return relation;
  }

  detach(relationId: RelationId): void {
    this.assertOpen();
    const relation = this.doc.relations.detach(relationId);
    this.relationOps.push({ op: 'detach', relation });
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
      changes: { created, updated, removed, relations: [...this.relationOps] },
      timestamp: Date.now(),
    };
  }

  rollback(): void {
    this.assertOpen();
    this.closed = true;
    // reverse relation ops first (they may reference created/removed entities)
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
