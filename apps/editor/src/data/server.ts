/**
 * Talking to editor-server, without ever being the reason something broke.
 *
 * The server is the source of truth for saved plans and the editor's small
 * stores; `localStorage` is the cache that keeps the app usable when the
 * server is not there. That only works if every call here is a question the
 * caller can ignore the answer to — so nothing throws, nothing rejects, and a
 * request that cannot be made is simply a `Result` that says so.
 */

/** how long to wait before deciding the server is not answering */
export const REQUEST_TIMEOUT_MS = 8000;

export type Result<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly reason: string };

/**
 * Where the server is.
 *
 * Empty means SAME ORIGIN, which is the deployed shape — editor-server serves
 * the SPA and the API together, so `/api/projects` just works and no build
 * needs to know a hostname. The env var is for local dev, where vite is on one
 * port and Nest on another.
 */
export function serverUrl(): string {
  const configured =
    (import.meta.env?.['VITE_EDITOR_SERVER_URL'] as string | undefined) ?? '';
  return configured.replace(/\/+$/, '');
}

/**
 * Whether it is even worth trying.
 *
 * `window` is the test for a browser, and it is the one that matters: the
 * tests run in node, where a stray request would be a real socket to a real
 * port and a suite that passes or fails on whether a server happens to be up.
 * `navigator.onLine` is advisory — it reports the radio, not the internet —
 * so it only short-circuits the obvious case rather than being trusted.
 */
export function canReachServer(): boolean {
  if (typeof window === 'undefined' || typeof fetch !== 'function')
    return false;
  return window.navigator?.onLine !== false;
}

/**
 * One request, answered rather than thrown.
 *
 * A timeout is not optional here. The draft and the save path both call into
 * this on a user action, and a server that accepts a connection and then says
 * nothing would otherwise hang the thing that called it forever — which on a
 * phone on a bad connection is the normal case, not the rare one.
 */
export async function api<T>(
  path: string,
  init: RequestInit = {},
): Promise<Result<T>> {
  if (!canReachServer()) return { ok: false, reason: 'offline' };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${serverUrl()}/api${path}`, {
      ...init,
      signal: controller.signal,
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      return { ok: false, reason: `server said ${response.status}` };
    }
    // 204 and an empty body are real answers — a DELETE has nothing to say
    const text = await response.text();
    return { ok: true, data: (text ? JSON.parse(text) : null) as T };
  } catch (error) {
    // an abort, a DNS failure, a CORS refusal, malformed JSON: all the same
    // thing to the caller, which is "not now"
    return {
      ok: false,
      reason: error instanceof Error ? error.message : 'request failed',
    };
  } finally {
    clearTimeout(timer);
  }
}
