import { describe, expect, it } from 'vitest';
import type { DocumentData } from '@acip/editor-core';
import {
  MAX_PROJECTS,
  PROJECTS_KEY,
  deleteProject,
  listProjects,
  openProject,
  readProjects,
  saveProject,
  savedAgo,
} from '@/data/projects';

/** localStorage, as a plain object — no DOM needed to test a Storage user */
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

describe('saving a plan', () => {
  it('hands back a plan that was put in', () => {
    const store = memoryStore();
    saveProject(store, 'Ground floor', doc(1), 1000);
    const saved = readProjects(store);
    expect(saved).toHaveLength(1);
    expect(saved[0].name).toBe('Ground floor');
    expect(openProject(store, saved[0].id)?.document).toEqual(doc(1));
  });

  it('keeps the newest first, whatever order they arrived', () => {
    const store = memoryStore();
    saveProject(store, 'One', doc(1), 1000);
    saveProject(store, 'Two', doc(2), 3000);
    saveProject(store, 'Three', doc(3), 2000);
    expect(listProjects(store).map((p) => p.name)).toEqual([
      'Two',
      'Three',
      'One',
    ]);
  });

  it('replaces a plan saved under a name that already exists', () => {
    // "Ground floor" saved twice is one drawing saved twice; a list that
    // filled with near-identical names would spend five slots in an afternoon
    const store = memoryStore();
    saveProject(store, 'Ground floor', doc(1), 1000);
    saveProject(store, 'ground FLOOR', doc(2), 2000);
    const saved = readProjects(store);
    expect(saved).toHaveLength(1);
    expect(saved[0].document).toEqual(doc(2));
  });

  it('pushes the oldest out at the cap', () => {
    // a cap rather than a warning: localStorage fails by THROWING when full,
    // and it would start refusing exactly when there is most to lose
    const store = memoryStore();
    for (let i = 1; i <= MAX_PROJECTS + 2; i += 1) {
      saveProject(store, `Plan ${i}`, doc(i), i * 1000);
    }
    const saved = listProjects(store);
    expect(saved).toHaveLength(MAX_PROJECTS);
    expect(saved[0].name).toBe(`Plan ${MAX_PROJECTS + 2}`);
    expect(saved.map((p) => p.name)).not.toContain('Plan 1');
  });

  it('names an unnamed plan rather than storing a blank', () => {
    const store = memoryStore();
    saveProject(store, '   ', doc(1), 1000);
    expect(readProjects(store)[0].name).toBe('Untitled plan');
  });
});

describe('reading a store that has been got at', () => {
  it('treats unreadable storage as empty rather than throwing', () => {
    // this is a cache in a browser the user also clears; a corrupt entry must
    // not be able to stop the editor opening
    expect(readProjects(memoryStore({ [PROJECTS_KEY]: 'not json' }))).toEqual(
      [],
    );
    expect(readProjects(memoryStore({ [PROJECTS_KEY]: '{"a":1}' }))).toEqual(
      [],
    );
  });

  it('drops entries that are not plans and keeps the ones that are', () => {
    const good = {
      id: 'x',
      name: 'Good',
      savedAt: 5,
      document: doc(1),
    };
    const store = memoryStore({
      [PROJECTS_KEY]: JSON.stringify([good, { id: 'y' }, null, 7]),
    });
    expect(readProjects(store).map((p) => p.name)).toEqual(['Good']);
  });

  it('survives a store that refuses to be written to', () => {
    // Safari private mode throws on setItem; saving must degrade, not crash
    const store = memoryStore();
    const readOnly = {
      ...store,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as Storage;
    expect(() => saveProject(readOnly, 'Plan', doc(1), 1)).not.toThrow();
  });
});

describe('forgetting a plan', () => {
  it('removes the one asked for and leaves the rest', () => {
    const store = memoryStore();
    saveProject(store, 'Keep', doc(1), 1000);
    saveProject(store, 'Drop', doc(2), 2000);
    const drop = readProjects(store).find((p) => p.name === 'Drop');
    const left = deleteProject(store, drop?.id ?? '');
    expect(left.map((p) => p.name)).toEqual(['Keep']);
    expect(openProject(store, drop?.id ?? '')).toBeNull();
  });
});

describe('when a plan was saved', () => {
  it('reads as time, not as a timestamp', () => {
    const now = 1_000_000_000;
    expect(savedAgo(now - 5_000, now)).toBe('just now');
    expect(savedAgo(now - 120_000, now)).toBe('2 min ago');
    expect(savedAgo(now - 3 * 3600_000, now)).toBe('3 h ago');
    expect(savedAgo(now - 24 * 3600_000, now)).toBe('yesterday');
    expect(savedAgo(now - 72 * 3600_000, now)).toBe('3 days ago');
  });

  it('never reads as the future when a clock has drifted', () => {
    const now = 1_000;
    expect(savedAgo(now + 60_000, now)).toBe('just now');
  });
});
