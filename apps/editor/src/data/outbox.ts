import { api, canReachServer } from './server';

/**
 * Writes the server has not accepted yet.
 *
 * The editor saves whether or not anything is listening — that is the whole
 * point of keeping `localStorage` as the cache — so a save made on a train has
 * to reach the server eventually without the user doing it again. This is that
 * "eventually": every write goes in here first, is attempted immediately, and
 * stays until the server takes it.
 *
 * It is NOT a log. Each entry is keyed by what it writes to, and a second
 * write to the same plan replaces the queued first one. The payload is the
 * whole document every time, so replaying an older one would be sending a plan
 * the user has already moved past — last write wins, and the queue should
 * never grow a history to be replayed in order.
 */
export const OUTBOX_KEY = 'acip.outbox.v1';

export interface PendingWrite {
  /** what this writes to — `project:<id>`, `store:<key>`; the dedupe key */
  readonly key: string;
  readonly method: 'PUT' | 'DELETE';
  readonly path: string;
  readonly body?: unknown;
  readonly queuedAt: number;
}

function isPending(value: unknown): value is PendingWrite {
  if (!value || typeof value !== 'object') return false;
  const raw = value as PendingWrite;
  return (
    typeof raw.key === 'string' &&
    (raw.method === 'PUT' || raw.method === 'DELETE') &&
    typeof raw.path === 'string' &&
    typeof raw.queuedAt === 'number'
  );
}

/** everything still owed to the server, oldest first */
export function readOutbox(store: Storage): PendingWrite[] {
  try {
    const raw = store.getItem(OUTBOX_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isPending) : [];
  } catch {
    return [];
  }
}

/** keep the queue, or carry on without it — see `writeDraft` for the argument */
export function writeOutbox(
  store: Storage,
  writes: readonly PendingWrite[],
): boolean {
  try {
    store.setItem(OUTBOX_KEY, JSON.stringify(writes));
    return true;
  } catch {
    return false;
  }
}

/**
 * Owe the server one write, replacing anything already owed for the same thing.
 *
 * Replacing and not appending is what keeps this bounded: a plan saved forty
 * times offline is one pending write, not forty, and the one that lands is the
 * one the user last pressed Save on.
 */
export function enqueue(store: Storage, write: PendingWrite): void {
  const rest = readOutbox(store).filter((one) => one.key !== write.key);
  writeOutbox(store, [...rest, write]);
}

/**
 * Hand the server everything it is owed.
 *
 * Stops at the FIRST failure and keeps the rest. A server that refused one
 * write is usually a server that is down, and grinding through forty more to
 * collect forty more failures only empties the user's battery — the next flush
 * will try again. The exception is a write the server actively rejected as bad
 * (a 4xx): that one will never succeed, and leaving it at the head of the
 * queue would block every write behind it forever, so it is dropped.
 */
export async function flushOutbox(
  store: Storage,
): Promise<{ sent: number; left: number }> {
  if (!canReachServer()) return { sent: 0, left: readOutbox(store).length };
  let sent = 0;
  for (const write of readOutbox(store)) {
    const result = await api(write.path, {
      method: write.method,
      ...(write.body === undefined ? {} : { body: JSON.stringify(write.body) }),
    });
    if (result.ok || isPermanent(result.reason)) {
      const rest = readOutbox(store).filter((one) => one.key !== write.key);
      writeOutbox(store, rest);
      if (result.ok) sent += 1;
      continue;
    }
    break;
  }
  return { sent, left: readOutbox(store).length };
}

/** a rejection no amount of retrying will turn into an acceptance */
function isPermanent(reason: string): boolean {
  const match = /server said (\d{3})/.exec(reason);
  if (!match) return false;
  const status = Number(match[1]);
  return status >= 400 && status < 500;
}
