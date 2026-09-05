import type { DocumentData } from '@acip/editor-core';

/**
 * Saved plans, in the browser.
 *
 * No backend yet, and this is deliberately not pretending there is one: a plan
 * lives in `localStorage` on the one device that drew it, and nothing here
 * syncs, merges or resolves a conflict. What it buys is the thing whose
 * absence hurt most — closing the tab stopped destroying an afternoon's work.
 *
 * `DocumentData` is core's own save shape (`saveDocument`), so a slot is
 * exactly what the file format would be. When a server does arrive, the thing
 * being posted is already the thing being stored.
 */
export const PROJECTS_KEY = 'acip.projects.v1';

/**
 * Five, and the sixth pushes the oldest out.
 *
 * A cap rather than a warning, because `localStorage` fails by THROWING when
 * it is full and a drawing is not small — an uncapped list would work for
 * weeks and then start refusing to save, at the point where the user has the
 * most to lose. Five is what a phone's list shows without scrolling.
 */
export const MAX_PROJECTS = 5;

export interface SavedProject {
  readonly id: string;
  readonly name: string;
  /** epoch ms, so the list can be ordered newest-first without parsing */
  readonly savedAt: number;
  readonly document: DocumentData;
}

/** what a slot looks like in the list, without carrying the whole drawing */
export interface ProjectSummary {
  readonly id: string;
  readonly name: string;
  readonly savedAt: number;
}

/**
 * Everything stored, newest first.
 *
 * Anything unreadable is treated as nothing rather than thrown: this is a
 * cache in a browser the user also clears, and a corrupt entry must not be
 * able to stop the editor opening. The cost of being wrong here is one lost
 * autosave; the cost of throwing is an app that will not start.
 */
export function readProjects(store: Storage): SavedProject[] {
  try {
    const raw = store.getItem(PROJECTS_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (p): p is SavedProject =>
          !!p &&
          typeof p === 'object' &&
          typeof (p as SavedProject).id === 'string' &&
          typeof (p as SavedProject).name === 'string' &&
          typeof (p as SavedProject).savedAt === 'number' &&
          !!(p as SavedProject).document,
      )
      .sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

/** the list as the menu shows it — no drawings, so it costs nothing to read */
export function listProjects(store: Storage): ProjectSummary[] {
  return readProjects(store).map(({ id, name, savedAt }) => ({
    id,
    name,
    savedAt,
  }));
}

/**
 * Put a plan in a slot.
 *
 * Saving under a name that already exists REPLACES it rather than adding a
 * second: "Ground floor" saved twice is one drawing saved twice, and a list
 * that filled with near-identical names would spend the five slots in an
 * afternoon.
 *
 * Returns the list as it now stands, so a caller never has to read back to
 * find out what happened.
 */
export function saveProject(
  store: Storage,
  name: string,
  document: DocumentData,
  now = Date.now(),
): SavedProject[] {
  const trimmed = name.trim() || 'Untitled plan';
  const existing = readProjects(store).filter(
    (p) => p.name.toLowerCase() !== trimmed.toLowerCase(),
  );
  const saved: SavedProject = {
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    name: trimmed,
    savedAt: now,
    document,
  };
  // newest first, then the oldest fall off the end
  const next = [saved, ...existing].slice(0, MAX_PROJECTS);
  try {
    store.setItem(PROJECTS_KEY, JSON.stringify(next));
  } catch {
    // out of room even after capping — a drawing can be megabytes. Dropping
    // the oldest and trying once more is the difference between "your last
    // save did not happen" and "saving is broken now".
    const trimmedList = next.slice(0, Math.max(1, next.length - 1));
    try {
      store.setItem(PROJECTS_KEY, JSON.stringify(trimmedList));
      return trimmedList;
    } catch {
      return readProjects(store);
    }
  }
  return next;
}

/** one plan back out, or null when the slot has gone */
export function openProject(store: Storage, id: string): SavedProject | null {
  return readProjects(store).find((p) => p.id === id) ?? null;
}

/** forget one, and hand back what is left */
export function deleteProject(store: Storage, id: string): SavedProject[] {
  const next = readProjects(store).filter((p) => p.id !== id);
  try {
    store.setItem(PROJECTS_KEY, JSON.stringify(next));
  } catch {
    /* nothing to do: the list on screen is still the truth we just computed */
  }
  return next;
}

/** "2 minutes ago", "yesterday" — a saved-at nobody has to decode */
export function savedAgo(savedAt: number, now = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - savedAt) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
