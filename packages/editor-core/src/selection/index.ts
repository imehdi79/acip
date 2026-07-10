import type { EntityId } from '../common/id.js';
import { TypedEventEmitter } from '../common/events.js';

export type SelectionEvents = {
  changed: readonly EntityId[];
};

export class SelectionSet {
  readonly events = new TypedEventEmitter<SelectionEvents>();
  private ids = new Set<EntityId>();

  add(id: EntityId): void {
    if (this.ids.has(id)) return;
    this.ids.add(id);
    this.emitChanged();
  }

  remove(id: EntityId): void {
    if (!this.ids.delete(id)) return;
    this.emitChanged();
  }

  toggle(id: EntityId): void {
    if (this.ids.has(id)) this.ids.delete(id);
    else this.ids.add(id);
    this.emitChanged();
  }

  clear(): void {
    if (this.ids.size === 0) return;
    this.ids.clear();
    this.emitChanged();
  }

  has(id: EntityId): boolean {
    return this.ids.has(id);
  }

  list(): EntityId[] {
    return [...this.ids];
  }

  get size(): number {
    return this.ids.size;
  }

  private emitChanged(): void {
    this.events.emit('changed', this.list());
  }
}
