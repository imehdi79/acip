import type { EntityId } from '../../common/id.js';
import { DocumentError } from '../../common/errors.js';
import type { EntityData } from '../../entities/base/data.js';
import type { EntityTypeRegistry } from '../../registry/entity-registry.js';
import type { DrawingDocument } from '../document.js';
import type { CommitRecord } from './transaction.js';

/**
 * Undo/redo by replaying commit-record snapshots. Redo re-applies after-state
 * (never re-executes commands) — deterministic by construction.
 *
 * Each stack entry is a GROUP of one or more commit records undone/redone
 * atomically. Normal dispatches are groups of one; beginGroup()/endGroup()
 * collapse a run of dispatches (an agent run, a multi-step tool) into a
 * single Ctrl+Z.
 */
export class HistoryStack {
  private undoStack: CommitRecord[][] = [];
  private redoStack: CommitRecord[][] = [];
  private group: CommitRecord[] | null = null;

  constructor(
    private doc: DrawingDocument,
    private registry: EntityTypeRegistry,
  ) {}

  push(record: CommitRecord): void {
    if (this.group) this.group.push(record);
    else this.undoStack.push([record]);
    this.redoStack = [];
  }

  /** subsequent pushes accumulate into one undo entry until endGroup() */
  beginGroup(): void {
    if (this.group) throw new DocumentError('history group already open');
    this.group = [];
  }

  endGroup(): void {
    const group = this.group;
    this.group = null;
    if (group && group.length > 0) this.undoStack.push(group);
  }

  /** group everything fn dispatches — safe across await points */
  async runGrouped<T>(fn: () => Promise<T>): Promise<T> {
    this.beginGroup();
    try {
      return await fn();
    } finally {
      this.endGroup();
    }
  }

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  undo(): readonly CommitRecord[] | null {
    if (this.group) throw new DocumentError('cannot undo while a history group is open');
    const entry = this.undoStack.pop();
    if (!entry) return null;
    for (let i = entry.length - 1; i >= 0; i--) {
      this.undoRecord(entry[i]);
    }
    this.redoStack.push(entry);
    return entry;
  }

  redo(): readonly CommitRecord[] | null {
    if (this.group) throw new DocumentError('cannot redo while a history group is open');
    const entry = this.redoStack.pop();
    if (!entry) return null;
    for (const record of entry) {
      this.redoRecord(record);
    }
    this.undoStack.push(entry);
    return entry;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.group = null;
  }

  private undoRecord(record: CommitRecord): void {
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

    this.doc._emitChange('undo', record);
  }

  private redoRecord(record: CommitRecord): void {
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

    this.doc._emitChange('redo', record);
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
