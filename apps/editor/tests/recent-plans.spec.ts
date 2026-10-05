import { afterEach, describe, expect, it } from 'vitest';
import { EditorSession, point, saveDocument } from '@acip/editor-core';
import type { EntityId, MaterialId } from '@acip/editor-core';
import { openProjectStore, readDraft } from '@/data/draft';
import {
  listProjects,
  openProject,
  saveProject,
  savedAgo,
} from '@/data/projects';
import { currentRates, resetRates, setManualRate } from '@/data/rates';
import { openSavedPlan } from '@/editor/open-plan';

/**
 * Reopening a plan from the Recent list is the same act as reopening it from
 * the header sheet, and both go through `openSavedPlan`. What is asserted here
 * is that "open" means all of it — the drawing, the prices it was quoted at,
 * and the slot it belongs to — because a second copy of those steps is exactly
 * how a plan arrives priced at another job's rates.
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

/** a session holding one wall, and the material it is built from */
function drawn(name: string, costCode: string) {
  const session = new EditorSession();
  session.dispatch<MaterialId>('MATERIAL.ADD', {
    name,
    unit: 'm2',
    costCode,
  });
  session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(4, 0),
    thickness: 0.3,
    height: 3,
  });
  return session;
}

afterEach(() => {
  resetRates();
  openProjectStore.set(null);
});

describe('the recent list', () => {
  it('is what has been saved, newest first', () => {
    const store = memoryStore();
    saveProject(
      store,
      {
        name: 'Ground floor',
        document: saveDocument(drawn('Paint', 'paint').doc),
      },
      1000,
    );
    saveProject(
      store,
      { name: 'Roof', document: saveDocument(drawn('Paint', 'paint').doc) },
      3000,
    );
    saveProject(
      store,
      {
        name: 'First floor',
        document: saveDocument(drawn('Paint', 'paint').doc),
      },
      2000,
    );
    expect(listProjects(store).map((p) => p.name)).toEqual([
      'Roof',
      'First floor',
      'Ground floor',
    ]);
  });

  it('carries a when, not just a what', () => {
    // a column of names says nothing about which one you were on; the list is
    // ordered newest first and this is what makes that visible
    const now = 1_000_000_000;
    expect(savedAgo(now - 120_000, now)).toBe('2 min ago');
  });

  it('is empty before anything has been saved', () => {
    expect(listProjects(memoryStore())).toEqual([]);
  });
});

describe('reopening a plan from the list', () => {
  it('puts the drawing back', () => {
    const store = memoryStore();
    const outcome = saveProject(
      store,
      {
        name: 'Ground floor',
        document: saveDocument(drawn('Paint', 'paint').doc),
      },
      1000,
    );
    if (!outcome.ok) throw new Error('save failed');

    // a different session, as a reopened plan always is
    const fresh = new EditorSession();
    expect(fresh.doc.all()).toHaveLength(0);
    openSavedPlan(fresh, outcome.saved, store);
    expect(fresh.doc.all().length).toBeGreaterThan(0);
    expect(fresh.doc.materials.list().map((m) => m.name)).toEqual(['Paint']);
  });

  it('replaces the drawing rather than merging into it', () => {
    // loadDocumentInto ADDS, and `levels.add` throws on an id it has seen —
    // so opening a second plan over a live one has to reset first
    const store = memoryStore();
    const first = saveProject(
      store,
      { name: 'A', document: saveDocument(drawn('Paint', 'paint').doc) },
      1000,
    );
    const second = saveProject(
      store,
      { name: 'B', document: saveDocument(drawn('Plaster', 'plaster').doc) },
      2000,
    );
    if (!first.ok || !second.ok) throw new Error('save failed');

    const session = new EditorSession();
    openSavedPlan(session, first.saved, store);
    expect(() => openSavedPlan(session, second.saved, store)).not.toThrow();
    expect(session.doc.materials.list().map((m) => m.name)).toEqual([
      'Plaster',
    ]);
  });

  it('prices it the way it was quoted, not the way this device prices now', () => {
    const store = memoryStore();
    setManualRate('paint', { unit: 'm2', unitCost: 12.5 }, store);
    const outcome = saveProject(
      store,
      {
        name: 'Ground floor',
        document: saveDocument(drawn('Paint', 'paint').doc),
        rates: { paint: { unit: 'm2', unitCost: 12.5 } },
      },
      1000,
    );
    if (!outcome.ok) throw new Error('save failed');

    // the device moves on — another job, a new quote
    setManualRate('paint', { unit: 'm2', unitCost: 30 }, store);
    expect(currentRates().rates['paint']?.unitCost).toBe(30);

    openSavedPlan(new EditorSession(), outcome.saved, store);
    // and the plan is still worth what it was worth
    expect(currentRates().rates['paint']?.unitCost).toBe(12.5);
  });

  it('attaches the drawing to the slot it came out of', () => {
    // so the next Save lands on this plan instead of forking it, or landing on
    // whichever plan the name box happened to prefill from
    const store = memoryStore();
    const outcome = saveProject(
      store,
      {
        name: 'Ground floor',
        document: saveDocument(drawn('Paint', 'paint').doc),
      },
      1000,
    );
    if (!outcome.ok) throw new Error('save failed');

    openSavedPlan(new EditorSession(), outcome.saved, store);
    expect(openProjectStore.get()).toBe(outcome.saved.id);
  });

  it('writes the draft, so a reload lands back on the plan', () => {
    // the Recent route depends on this: the provider restores the draft when
    // the editor comes up, and it has to find this plan rather than the last
    const store = memoryStore();
    const outcome = saveProject(
      store,
      {
        name: 'Ground floor',
        document: saveDocument(drawn('Paint', 'paint').doc),
      },
      1000,
    );
    if (!outcome.ok) throw new Error('save failed');

    openSavedPlan(new EditorSession(), outcome.saved, store);
    const draft = readDraft(store);
    expect(draft?.projectId).toBe(outcome.saved.id);
    expect(draft?.document).toEqual(outcome.saved.document);
  });

  it('opens nothing for a slot that has gone', () => {
    // deleted in another tab between the list being read and the row tapped
    expect(openProject(memoryStore(), 'gone')).toBeNull();
  });
});
