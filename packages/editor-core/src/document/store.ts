/** Anything kept in a document-level table: plain, JSON-safe, with an id. */
export interface StoreItem {
  readonly id: string;
}

/**
 * The uniform surface transactions mutate document stores through —
 * what makes LEVEL.ADD as undoable as LINE.ADD.
 */
export interface MutableStore<T extends StoreItem> {
  get(id: string): T | null;
  has(id: string): boolean;
  /** add or replace */
  set(item: T): void;
  delete(id: string): boolean;
  list(): T[];
}

export class RecordTable<T extends StoreItem> implements MutableStore<T> {
  protected items = new Map<string, T>();

  get(id: string): T | null {
    return this.items.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

  set(item: T): void {
    this.items.set(item.id, item);
  }

  delete(id: string): boolean {
    return this.items.delete(id);
  }

  list(): T[] {
    return [...this.items.values()];
  }
}
