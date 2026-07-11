import { useSyncExternalStore } from 'react';

/** Minimal external store so chrome components can subscribe without a state library. */
export class ValueStore<T> {
  private listeners = new Set<() => void>();

  constructor(private value: T) {}

  get = (): T => this.value;

  set = (next: T): void => {
    if (Object.is(next, this.value)) return;
    this.value = next;
    for (const fn of [...this.listeners]) fn();
  };

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
}

export function useStoreValue<T>(store: ValueStore<T>): T {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
