import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocumentData } from '@acip/editor-core';
import {
  OUTBOX_KEY,
  enqueue,
  flushOutbox,
  readOutbox,
  writeOutbox,
} from '@/data/outbox';
import { api, canReachServer } from '@/data/server';
import { pushProject, pushProjectDeletion, pushStore } from '@/data/sync';
import { MANUAL_RATES_KEY } from '@/data/rates';
import { LAYER_DEFAULTS_KEY } from '@/data/layer-defaults';
import type { SavedProject } from '@/data/projects';

/**
 * The editor saves to the browser and owes the server a copy. What is asserted
 * here is the "owes" half: that a write survives being made with no network,
 * that replaying it cannot duplicate or reorder anything, and that a request
 * the server will never accept does not wedge the queue behind it forever.
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

const plan = (id: string, n = 1): SavedProject => ({
  id,
  name: `Plan ${id}`,
  savedAt: 1000 * n,
  document: doc(n),
});

/** pretend to be a browser with a network, and answer every request with this */
function online(responder: (url: string, init: RequestInit) => Response) {
  vi.stubGlobal('window', { navigator: { onLine: true } });
  vi.stubGlobal(
    'fetch',
    vi.fn((url: string, init: RequestInit = {}) =>
      Promise.resolve(responder(url, init)),
    ),
  );
}

const okJson = (body: unknown) =>
  new Response(JSON.stringify(body), { status: 200 });

afterEach(() => vi.unstubAllGlobals());

describe('what the browser still owes the server', () => {
  it('keeps a write that could not be sent', () => {
    const store = memoryStore();
    pushProject(store, plan('p1'));
    const owed = readOutbox(store);
    expect(owed).toHaveLength(1);
    expect(owed[0].method).toBe('PUT');
    expect(owed[0].path).toBe('/projects/p1');
  });

  it('replaces rather than appends when the same plan is saved again', () => {
    // a plan saved forty times on a train is ONE pending write, and the one
    // that lands is the last Save — replaying older copies would be sending a
    // drawing the user has already moved past
    const store = memoryStore();
    pushProject(store, plan('p1', 1));
    pushProject(store, plan('p1', 2));
    pushProject(store, plan('p1', 3));
    const owed = readOutbox(store);
    expect(owed).toHaveLength(1);
    expect((owed[0].body as SavedProject).savedAt).toBe(3000);
  });

  it('lets a deletion supersede a queued save of the same plan', () => {
    // same key on purpose: saving then deleting offline must not replay as a
    // save followed by a delete of something, it is simply gone
    const store = memoryStore();
    pushProject(store, plan('p1'));
    pushProjectDeletion(store, 'p1');
    const owed = readOutbox(store);
    expect(owed).toHaveLength(1);
    expect(owed[0].method).toBe('DELETE');
  });

  it('keeps separate plans separate', () => {
    const store = memoryStore();
    pushProject(store, plan('p1'));
    pushProject(store, plan('p2'));
    expect(readOutbox(store)).toHaveLength(2);
  });

  it('files each small store under the server’s own name for it', () => {
    const store = memoryStore();
    pushStore(store, MANUAL_RATES_KEY, { paint: { unit: 'm2', unitCost: 12 } });
    pushStore(store, LAYER_DEFAULTS_KEY, { paint: { width: 3 } });
    expect(readOutbox(store).map((w) => w.path)).toEqual([
      '/store/manual-rates',
      '/store/layer-defaults',
    ]);
  });

  it('ignores a store key the server has never heard of', () => {
    const store = memoryStore();
    pushStore(store, 'acip.something.else', { a: 1 });
    expect(readOutbox(store)).toEqual([]);
  });

  it('treats an unreadable queue as nothing rather than throwing', () => {
    expect(readOutbox(memoryStore({ [OUTBOX_KEY]: 'not json' }))).toEqual([]);
    expect(readOutbox(memoryStore({ [OUTBOX_KEY]: '{"a":1}' }))).toEqual([]);
  });

  it('drops queue entries that are not writes', () => {
    const store = memoryStore({
      [OUTBOX_KEY]: JSON.stringify([
        { key: 'project:p1', method: 'PUT', path: '/projects/p1', queuedAt: 1 },
        { key: 'bad', method: 'PATCH', path: '/x', queuedAt: 1 },
        null,
      ]),
    });
    expect(readOutbox(store)).toHaveLength(1);
  });
});

describe('paying the server what it is owed', () => {
  it('sends everything and empties the queue', async () => {
    online(() => okJson({}));
    const store = memoryStore();
    pushProject(store, plan('p1'));
    pushProject(store, plan('p2'));
    const result = await flushOutbox(store);
    expect(result.sent).toBe(2);
    expect(readOutbox(store)).toEqual([]);
  });

  it('keeps the queue when the server is not answering', async () => {
    vi.stubGlobal('window', { navigator: { onLine: true } });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))),
    );
    const store = memoryStore();
    pushProject(store, plan('p1'));
    const result = await flushOutbox(store);
    expect(result.sent).toBe(0);
    expect(readOutbox(store)).toHaveLength(1);
  });

  it('stops at the first refusal instead of grinding through the rest', async () => {
    // a server that refused one write is usually a server that is down;
    // collecting forty more failures only empties the battery
    let calls = 0;
    vi.stubGlobal('window', { navigator: { onLine: true } });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => {
        calls += 1;
        return Promise.reject(new Error('offline'));
      }),
    );
    const store = memoryStore();
    // seeded directly, because pushProject optimistically flushes on its way
    // out and this is counting what ONE flush does
    writeOutbox(store, [
      { key: 'project:p1', method: 'PUT', path: '/projects/p1', queuedAt: 1 },
      { key: 'project:p2', method: 'PUT', path: '/projects/p2', queuedAt: 2 },
      { key: 'project:p3', method: 'PUT', path: '/projects/p3', queuedAt: 3 },
    ]);
    await flushOutbox(store);
    expect(calls).toBe(1);
    expect(readOutbox(store)).toHaveLength(3);
  });

  it('drops a write the server will never accept', async () => {
    // a 400 is not a network problem and will not become one: left at the head
    // of the queue it would block every good write behind it forever
    online(() => new Response('bad', { status: 400 }));
    const store = memoryStore();
    pushProject(store, plan('p1'));
    const result = await flushOutbox(store);
    expect(result.sent).toBe(0);
    expect(readOutbox(store)).toEqual([]);
  });

  it('retries a write the server merely failed to handle', async () => {
    // a 500 is transient by assumption — the write is still good
    online(() => new Response('boom', { status: 500 }));
    const store = memoryStore();
    pushProject(store, plan('p1'));
    await flushOutbox(store);
    expect(readOutbox(store)).toHaveLength(1);
  });

  it('does nothing at all without a browser', async () => {
    // the tests run in node, and a stray request here would be a real socket
    // to a real port — a suite that passes on whether a server happens to be up
    const store = memoryStore();
    writeOutbox(store, [
      { key: 'project:p1', method: 'PUT', path: '/projects/p1', queuedAt: 1 },
    ]);
    expect(canReachServer()).toBe(false);
    const result = await flushOutbox(store);
    expect(result.sent).toBe(0);
    expect(result.left).toBe(1);
  });
});

describe('asking the server a question', () => {
  it('answers rather than throwing when there is no network', async () => {
    const result = await api('/projects');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('offline');
  });

  it('answers rather than throwing when the request blows up', async () => {
    vi.stubGlobal('window', { navigator: { onLine: true } });
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('DNS'))),
    );
    const result = await api('/projects');
    expect(result.ok).toBe(false);
  });

  it('reports the status when the server says no', async () => {
    online(() => new Response('nope', { status: 404 }));
    const result = await api('/projects/missing');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('404');
  });

  it('treats an empty body as a real answer', async () => {
    // a DELETE has nothing to say, and JSON.parse('') would throw
    online(() => new Response('', { status: 200 }));
    const result = await api('/projects/p1', { method: 'DELETE' });
    expect(result.ok).toBe(true);
  });

  it('is not reachable when the browser says it is offline', () => {
    vi.stubGlobal('window', { navigator: { onLine: false } });
    vi.stubGlobal('fetch', vi.fn());
    expect(canReachServer()).toBe(false);
  });

  it('enqueuing never fails a save, even with no queue to write to', () => {
    // the save already landed in the cache by this point; a queue that cannot
    // be written must not throw back into the thing that called it
    const store = memoryStore();
    const readOnly = {
      ...store,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as Storage;
    expect(() =>
      enqueue(readOnly, {
        key: 'project:p1',
        method: 'PUT',
        path: '/projects/p1',
        queuedAt: 1,
      }),
    ).not.toThrow();
  });
});
