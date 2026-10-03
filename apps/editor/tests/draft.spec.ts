import { afterEach, describe, expect, it } from 'vitest';
import type { DocumentData } from '@acip/editor-core';
import {
  DRAFT_KEY,
  clearDraft,
  openProjectStore,
  readDraft,
  writeDraft,
} from '@/data/draft';

/**
 * The draft is the answer to the worst thing this app did: a reload replaced
 * an afternoon's work with an empty room, because the settings store remembered
 * which starter template was picked and the fresh session remembered nothing.
 *
 * It is not a sixth saved plan. It is one slot holding the thing on screen, so
 * that keeping work never requires first deciding to name it.
 */

function memoryStore(seed: Record<string, string> = {}): Storage {
  const map = new Map(Object.entries(seed));
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (k: string) => void map.delete(k),
    setItem: (k: string, v: string) => void map.set(k, v),
  } as Storage;
}

const doc = (n: number) =>
  ({ entities: [{ id: `e${n}` }] }) as unknown as DocumentData;

afterEach(() => openProjectStore.set(null));

describe('the drawing as it stands', () => {
  it('comes back exactly as it went in', () => {
    const store = memoryStore();
    writeDraft(store, { savedAt: 1000, document: doc(1), projectId: null });
    const draft = readDraft(store);
    expect(draft?.document).toEqual(doc(1));
    expect(draft?.savedAt).toBe(1000);
  });

  it('remembers which saved plan it belongs to', () => {
    // without this, reopening the tab leaves a drawing that cannot be matched
    // to a slot, and the next Save writes a new one — or lands on whichever
    // plan the name box happened to prefill from
    const store = memoryStore();
    writeDraft(store, { savedAt: 1, document: doc(1), projectId: 'p1' });
    expect(readDraft(store)?.projectId).toBe('p1');
  });

  it('is nothing when nothing has been drawn', () => {
    expect(readDraft(memoryStore())).toBeNull();
  });

  it('is nothing when the key is unreadable, rather than throwing', () => {
    // a corrupt key must not be able to stop the editor opening: the cost of
    // being wrong here is one restore, the cost of throwing is the whole app
    expect(readDraft(memoryStore({ [DRAFT_KEY]: 'not json' }))).toBeNull();
    expect(readDraft(memoryStore({ [DRAFT_KEY]: '"a string"' }))).toBeNull();
    expect(readDraft(memoryStore({ [DRAFT_KEY]: '{"savedAt":1}' }))).toBeNull();
  });

  it('treats a non-string project id as unattached', () => {
    const store = memoryStore({
      [DRAFT_KEY]: JSON.stringify({
        savedAt: 1,
        document: doc(1),
        projectId: 7,
      }),
    });
    expect(readDraft(store)?.projectId).toBeNull();
  });

  it('survives a store that refuses to be written to', () => {
    // a draft that cannot be kept must not take down the edit that triggered
    // it — the user carries on drawing, no worse off than before this existed
    const store = memoryStore();
    const readOnly = {
      ...store,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as Storage;
    expect(
      writeDraft(readOnly, { savedAt: 1, document: doc(1), projectId: null }),
    ).toBe(false);
  });

  it('is forgotten when the drawing is deliberately replaced', () => {
    // picking a new starter plan says the old drawing is not wanted; a reload
    // after that must not hand it back
    const store = memoryStore();
    writeDraft(store, { savedAt: 1, document: doc(1), projectId: null });
    clearDraft(store);
    expect(readDraft(store)).toBeNull();
  });

  it('overwrites rather than accumulating', () => {
    // one slot, not a history: this is what the user is looking at
    const store = memoryStore();
    writeDraft(store, { savedAt: 1, document: doc(1), projectId: null });
    writeDraft(store, { savedAt: 2, document: doc(2), projectId: null });
    expect(readDraft(store)?.document).toEqual(doc(2));
    expect(store.length).toBe(1);
  });
});

describe('which plan is open', () => {
  it('starts attached to nothing', () => {
    expect(openProjectStore.get()).toBeNull();
  });

  it('is readable the moment it is set, without a round trip', () => {
    // the sheet has to show it on Open and on Save, moments that have nothing
    // to do with the document changing
    openProjectStore.set('p1');
    expect(openProjectStore.get()).toBe('p1');
  });
});
