import type { SavedProject } from './projects';
import { PROJECTS_KEY } from './projects';
import { MANUAL_RATES_KEY } from './rates';
import { LAYER_DEFAULTS_KEY } from './layer-defaults';
import { enqueue, flushOutbox } from './outbox';
import { api, canReachServer } from './server';

/**
 * Keeping the browser and the server saying the same thing.
 *
 * The shape is server-first with a local cache, and the asymmetry is
 * deliberate. WRITES go to `localStorage` synchronously and to the server in
 * the background, because a save has to be instant and has to work on a train.
 * READS come from the cache during render — nothing on screen waits on a
 * network — and the server reconciles it afterwards.
 *
 * Which means the cache is never a second source of truth; it is a copy of the
 * last answer the server gave, plus whatever this device has written since and
 * the server has not acknowledged. The outbox is what closes that gap.
 */

/** the settings blob zustand persists, parked under one key like the others */
export const SETTINGS_KEY = 'acip-editor-settings';

/** store key -> the server's own name for it */
const STORE_KEYS: Readonly<Record<string, string>> = {
  [MANUAL_RATES_KEY]: 'manual-rates',
  [LAYER_DEFAULTS_KEY]: 'layer-defaults',
  [SETTINGS_KEY]: 'editor-settings',
};

/**
 * Take the server's copy as the truth, into the cache.
 *
 * Run at start-up, AFTER the outbox has been flushed — the other way round and
 * a plan saved offline would be overwritten by the server's older copy of it
 * before it was ever sent. That ordering is the whole correctness argument for
 * offline editing, and it is one line in `startSync` below.
 *
 * A failure is not an error. It means the editor runs on its cache, which is
 * exactly what it did before any of this existed.
 */
export async function pullFromServer(store: Storage): Promise<boolean> {
  if (!canReachServer()) return false;

  const projects = await api<SavedProject[]>('/projects');
  if (projects.ok && Array.isArray(projects.data)) {
    try {
      store.setItem(PROJECTS_KEY, JSON.stringify(projects.data));
    } catch {
      /* a cache that will not take the server's answer still has its own */
    }
  }

  for (const [localKey, remoteKey] of Object.entries(STORE_KEYS)) {
    const result = await api<{ value: unknown }>(`/store/${remoteKey}`);
    // `null` is "nobody has written this yet", which must NOT clobber a cache
    // that has something in it — a fresh server would otherwise wipe the
    // device that is about to populate it
    if (!result.ok || result.data?.value == null) continue;
    try {
      store.setItem(localKey, JSON.stringify(result.data.value));
    } catch {
      /* same */
    }
  }
  return projects.ok;
}

/** owe the server this plan, and try to pay now */
export function pushProject(store: Storage, project: SavedProject): void {
  enqueue(store, {
    key: `project:${project.id}`,
    method: 'PUT',
    path: `/projects/${encodeURIComponent(project.id)}`,
    body: {
      name: project.name,
      savedAt: project.savedAt,
      document: project.document,
      ...(project.rates ? { rates: project.rates } : {}),
      ...(project.defaults ? { defaults: project.defaults } : {}),
    },
    queuedAt: Date.now(),
  });
  void flushOutbox(store);
}

/** owe the server this deletion — same key, so it supersedes a queued save */
export function pushProjectDeletion(store: Storage, id: string): void {
  enqueue(store, {
    key: `project:${id}`,
    method: 'DELETE',
    path: `/projects/${encodeURIComponent(id)}`,
    queuedAt: Date.now(),
  });
  void flushOutbox(store);
}

/**
 * Owe the server one of the small stores, whole.
 *
 * Whole and not a patch, because that is how the editor already treats them:
 * the rate table is read and set as one value, and inventing a field-level
 * merge here would be inventing a conflict model for data that has never had
 * one. The cost is that two devices editing rates at once is last-write-wins,
 * which is worth saying out loud and is the right trade at one office.
 */
export function pushStore(
  store: Storage,
  localKey: string,
  value: unknown,
): void {
  const remoteKey = STORE_KEYS[localKey];
  if (!remoteKey) return;
  enqueue(store, {
    key: `store:${remoteKey}`,
    method: 'PUT',
    path: `/store/${remoteKey}`,
    body: { value },
    queuedAt: Date.now(),
  });
  void flushOutbox(store);
}

/**
 * Start keeping the two in step, and hand back the way to stop.
 *
 * Flush THEN pull, for the reason `pullFromServer` gives. The `online` event
 * is the one signal a browser actually offers that the network came back, and
 * it is worth having: the common offline case is a phone in a basement, and
 * the common recovery is walking out of it rather than reopening the app.
 */
export function startSync(store: Storage): () => void {
  const sync = () => {
    void flushOutbox(store).then(() => pullFromServer(store));
  };
  sync();
  if (typeof window === 'undefined') return () => undefined;
  window.addEventListener('online', sync);
  return () => window.removeEventListener('online', sync);
}
