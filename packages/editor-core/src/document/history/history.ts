import type { EntityId } from '../../common/id.js';
import type { EntityData } from '../../entities/base/data.js';
import type { EntityTypeRegistry } from '../../registry/entity-registry.js';
import type { DrawingDocument } from '../document.js';
import type { CommitRecord } from './transaction.js';

/**
 * Undo/redo by replaying commit-record snapshots. Redo re-applies after-state
 * (never re-executes commands) — deterministic by construction.
 */
export class HistoryStack {
  private undoStack: CommitRecord[] = [];
  private redoStack: CommitRecord[] = [];

  constructor(
    private doc: DrawingDocument,
    private registry: EntityTypeRegistry,
  ) {}

  push(record: CommitRecord): void {
    this.undoStack.push(record);
    this.redoStack = [];
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): CommitRecord | null {
    const record = this.undoStack.pop();
    if (!record) return null;

    // stores first: restored entities may reference their items (levels, layers)
    const stores = record.changes.stores;
    for (let i = stores.length - 1; i >= 0; i--) {
      const change = stores[i];
      const table = this.doc._store(change.store);
      if (change.op === 'add') table.delete(change.item.id);
      else if (change.op === 'update') table.set(structuredClone(change.before));
      else table.set(structuredClone(change.item));
    }

    const rels = record.changes.relations;
    for (let i = rels.length - 1; i >= 0; i--) {
      const op = rels[i];
      if (op.op === 'attach') this.doc.relations.detach(op.relation.id);
    }
    for (const data of record.changes.created) {
      this.doc._delete(data.id as EntityId);
    }
    for (const data of record.changes.removed) {
      this.restoreEntity(data);
    }
    for (let i = rels.length - 1; i >= 0; i--) {
      const op = rels[i];
      if (op.op === 'detach') this.doc.relations.restore(op.relation);
    }
    for (const { before } of record.changes.updated) {
      this.applyState(before);
    }

    this.redoStack.push(record);
    this.doc._emitChange('undo', record);
    return record;
  }

  redo(): CommitRecord | null {
    const record = this.redoStack.pop();
    if (!record) return null;

    for (const change of record.changes.stores) {
      const table = this.doc._store(change.store);
      if (change.op === 'add') table.set(structuredClone(change.item));
      else if (change.op === 'update') table.set(structuredClone(change.after));
      else table.delete(change.item.id);
    }

    for (const op of record.changes.relations) {
      if (op.op === 'detach') this.doc.relations.detach(op.relation.id);
    }
    for (const data of record.changes.removed) {
      this.doc._delete(data.id as EntityId);
    }
    for (const data of record.changes.created) {
      this.restoreEntity(data);
    }
    for (const op of record.changes.relations) {
      if (op.op === 'attach') this.doc.relations.restore(op.relation);
    }
    for (const { after } of record.changes.updated) {
      this.applyState(after);
    }

    this.undoStack.push(record);
    this.doc._emitChange('redo', record);
    return record;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
  }

  private restoreEntity(data: EntityData): void {
    const entity = this.registry.restore(data);
    this.doc._insert(entity);
  }

  private applyState(data: EntityData): void {
    const entity = this.doc.get(data.id as EntityId);
    if (!entity) return;
    entity.loadData(data);
    this.doc._entityChanged(entity);
  }
}
