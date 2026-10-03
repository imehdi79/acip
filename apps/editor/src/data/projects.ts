import type { DocumentData } from '@acip/editor-core';
import type { Rate } from '@acip/estimator';
import type { LayerDefaults } from './layer-defaults';

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
 * it is full. It is a generous cap on current evidence — the example drawing
 * is about 20 kB, so five of them is a fiftieth of a typical 5 MB quota — and
 * that is the point: the cap is cheap insurance, not the thing standing
 * between the user and a lost afternoon. What stands there is `ok` on the
 * result below actually reaching the screen.
 */
export const MAX_PROJECTS = 5;

/**
 * One saved plan: the drawing, and what it was priced at.
 *
 * The prices TRAVEL WITH IT, and that is the whole reason this type is not
 * just `DocumentData`. Core stores a `costCode` on a material and never a
 * figure, so rates live app-side; left only in the device-wide table, two
 * plans could never disagree about what plaster costs, and quoting a second
 * job would silently re-value the first. A bill of quantities that changes
 * value after it is quoted is not a bill of quantities.
 *
 * Both are optional so a plan saved before they existed still opens; it simply
 * prices against the device table, which is what it did at the time.
 */
export interface SavedProject {
  readonly id: string;
  readonly name: string;
  /** epoch ms, so the list can be ordered newest-first without parsing */
  readonly savedAt: number;
  readonly document: DocumentData;
  /** what the drawing's own cost codes were worth when it was saved */
  readonly rates?: Readonly<Record<string, Rate>>;
  /** what a layer of each started as when it was saved */
  readonly defaults?: Readonly<Record<string, LayerDefaults>>;
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

/**
 * The list as the menu shows it.
 *
 * It still parses every stored drawing to get here — `localStorage` hands back
 * one string for the whole list, so there is no cheaper read without splitting
 * the slots across keys. Worth knowing before this is called in a render.
 */
export function listProjects(store: Storage): ProjectSummary[] {
  return readProjects(store).map(({ id, name, savedAt }) => ({
    id,
    name,
    savedAt,
  }));
}

/** what to save, and over which slot */
export interface SaveRequest {
  readonly name: string;
  readonly document: DocumentData;
  readonly rates?: Readonly<Record<string, Rate>>;
  readonly defaults?: Readonly<Record<string, LayerDefaults>>;
  /**
   * The slot this drawing came OUT of, when it came out of one.
   *
   * Without it, saving a plan you opened an hour ago writes a new slot and
   * leaves the original holding the version you started from — and if the name
   * box happened to carry another plan's name, it overwrote that one instead.
   * Identity beats the name: a rename is a rename, not a new plan.
   */
  readonly id?: string | null;
}

/**
 * How a save went, in enough detail for the sheet to say so.
 *
 * A boolean would not do. The thing this replaces returned a list whether or
 * not anything had been written, so a save that could not happen closed the
 * sheet looking exactly like one that did — the single worst behaviour a save
 * button can have.
 */
export type SaveOutcome =
  | {
      readonly ok: true;
      readonly projects: readonly SavedProject[];
      readonly saved: SavedProject;
      /** plans pushed out to make room, so the sheet can say which */
      readonly evicted: readonly SavedProject[];
    }
  | {
      readonly ok: false;
      readonly projects: readonly SavedProject[];
      readonly reason: string;
    };

/**
 * Put a plan in a slot.
 *
 * The slot is chosen by ID first and by name second. Saving over a plan you
 * opened keeps its id even if you renamed it; saving a drawing that came from
 * nowhere under a name already on the list replaces that one, because "Ground
 * floor" saved twice is one drawing saved twice and five slots would otherwise
 * go in an afternoon.
 *
 * The id is REUSED rather than regenerated, which is what makes "the plan I
 * have open" a thing that can survive a save at all.
 */
export function saveProject(
  store: Storage,
  request: SaveRequest,
  now = Date.now(),
): SaveOutcome {
  const name = request.name.trim() || 'Untitled plan';
  const before = readProjects(store);

  const target =
    (request.id ? before.find((p) => p.id === request.id) : undefined) ??
    before.find((p) => p.name.toLowerCase() === name.toLowerCase());

  const saved: SavedProject = {
    id: target?.id ?? `${now}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    savedAt: now,
    document: request.document,
    ...(request.rates ? { rates: request.rates } : {}),
    ...(request.defaults ? { defaults: request.defaults } : {}),
  };

  const rest = before.filter((p) => p.id !== saved.id);
  const next = [saved, ...rest];
  const kept = next.slice(0, MAX_PROJECTS);
  const evicted = next.slice(MAX_PROJECTS);

  if (write(store, kept)) {
    return { ok: true, projects: kept, saved, evicted };
  }

  // Out of room. Dropping the oldest and trying again is worth one attempt —
  // but only while there IS an older one to drop. Retrying a single-slot list
  // with itself, which is what this used to do, re-sends the identical payload
  // and fails identically.
  if (kept.length > 1) {
    const fewer = kept.slice(0, kept.length - 1);
    if (write(store, fewer)) {
      return {
        ok: true,
        projects: fewer,
        saved,
        evicted: [...evicted, ...kept.slice(kept.length - 1)],
      };
    }
  }

  return {
    ok: false,
    projects: before,
    reason:
      'There is no room left in this browser for a plan this size. Delete a saved plan and try again.',
  };
}

/** the one write, so every caller fails the same way */
function write(store: Storage, projects: readonly SavedProject[]): boolean {
  try {
    store.setItem(PROJECTS_KEY, JSON.stringify(projects));
    return true;
  } catch {
    return false;
  }
}

/** one plan back out, or null when the slot has gone */
export function openProject(store: Storage, id: string): SavedProject | null {
  return readProjects(store).find((p) => p.id === id) ?? null;
}

/** forget one, and hand back what is left */
export function deleteProject(store: Storage, id: string): SavedProject[] {
  const next = readProjects(store).filter((p) => p.id !== id);
  write(store, next);
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
