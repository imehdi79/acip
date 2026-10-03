import { afterEach, describe, expect, it } from 'vitest';
import {
  LAYER_DEFAULTS_KEY,
  currentLayerDefaults,
  defaultsFor,
  hydrateLayerDefaults,
  readLayerDefaults,
  resetLayerDefaults,
  setLayerDefaults,
  writeLayerDefaults,
} from '@/data/layer-defaults';

/**
 * What a layer STARTS as, which core has nowhere to keep: a finish's extent
 * lives on the entity, and a material that carried one would make every
 * drawing opening the file inherit one office's habits as fact.
 *
 * So it sits beside the rates, keyed the same way and persisted the same way,
 * and is only ever read at the moment a layer is applied.
 */

function fakeStorage(failing = false): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => {
      if (failing) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
  };
}

afterEach(() => resetLayerDefaults());

describe('what a layer of a material starts as', () => {
  it('is nothing at all until something is recorded', () => {
    // empty and never null: "nobody has said" and "said nothing in particular"
    // are the same answer for a size, unlike a price
    expect(defaultsFor('plaster')).toEqual({});
    expect(defaultsFor('plaster').width).toBeUndefined();
  });

  it('comes back under the cost code it was filed with', () => {
    setLayerDefaults('plaster', { width: 3.7, height: 1.2 });
    expect(defaultsFor('plaster')).toEqual({ width: 3.7, height: 1.2 });
  });

  it('keeps a description beside the sizes', () => {
    setLayerDefaults('plaster', { description: '  12mm board  ' });
    // trimmed on the way in, so one stray space is not a different note
    expect(defaultsFor('plaster').description).toBe('12mm board');
  });

  it('REPLACES rather than merges, so a cleared box takes a default off', () => {
    setLayerDefaults('plaster', { width: 3.7, height: 1.2 });
    setLayerDefaults('plaster', { width: 2 });
    // the form shows every field at once, so what it hands over is the whole
    // answer — merging would leave no way to take a height back off
    expect(defaultsFor('plaster')).toEqual({ width: 2 });
  });

  it('drops the entry entirely when every box is cleared', () => {
    setLayerDefaults('plaster', { width: 3.7 });
    setLayerDefaults('plaster', {});
    expect(currentLayerDefaults()['plaster']).toBeUndefined();
  });

  it('refuses a size that is not one', () => {
    setLayerDefaults('plaster', { width: 0 });
    setLayerDefaults('paint', { height: Number.NaN });
    setLayerDefaults('', { width: 2 });
    // a size of nothing is a band that should not have been drawn, and a width
    // read as NaN would reach coverPatch as a `t1` the document cannot draw
    expect(currentLayerDefaults()).toEqual({});
  });

  it('keeps them for the next visit', () => {
    const store = fakeStorage();
    setLayerDefaults('plaster', { width: 3.7 }, store);
    expect(readLayerDefaults(store)).toEqual({ plaster: { width: 3.7 } });
  });

  it('still applies a default it could not keep', () => {
    const store = fakeStorage(true);
    expect(setLayerDefaults('plaster', { width: 3.7 }, store)).toBe(false);
    expect(defaultsFor('plaster').width).toBe(3.7);
  });
});

describe('what this device recorded, on the next visit', () => {
  it('comes back as it went in', () => {
    const store = fakeStorage();
    writeLayerDefaults(store, { plaster: { width: 3.7, height: 1.2 } });
    hydrateLayerDefaults(store);
    expect(defaultsFor('plaster')).toEqual({ width: 3.7, height: 1.2 });
  });

  it('treats an unreadable key as nothing rather than throwing', () => {
    const store = fakeStorage();
    store.setItem(LAYER_DEFAULTS_KEY, 'not json at all');
    expect(readLayerDefaults(store)).toEqual({});
    expect(() => hydrateLayerDefaults(store)).not.toThrow();
  });

  it('drops the rows inside it that are not defaults', () => {
    const store = fakeStorage();
    store.setItem(
      LAYER_DEFAULTS_KEY,
      JSON.stringify({
        good: { width: 3.7, description: 'fine' },
        'bad-width': { width: 'wide' },
        'bad-zero': { height: 0 },
        'bad-note': { description: 12 },
      }),
    );
    expect(Object.keys(readLayerDefaults(store))).toEqual(['good']);
  });
});
