import type { DocumentData } from '@acip/editor-core';
import { ValueStore } from '@/editor/store';

/**
 * The drawing as it stands right now, kept so a reload does not destroy it.
 *
 * Saving a plan was always deliberate — open the sheet, name it, press Save —
 * and everything between two of those presses lived only in memory. A reload
 * then did worse than lose it: the settings store remembers which starter
 * template was picked, so `generatePlan` ran again on the fresh session and
 * replaced the afternoon's work with an empty room. The crash, the stray
 * refresh and the phone killing a background tab all ended the same way.
 *
 * This is not a sixth saved plan and does not appear in the list. It is one
 * slot, overwritten continuously, holding the thing the user is looking at —
 * a named plan is a decision, and losing work should not require making one.
 */
export const DRAFT_KEY = 'acip.draft.v1';

/**
 * How long after the last edit the draft is written.
 *
 * The document announces one `change` per committed transaction, not per
 * frame, so a drag arrives as a single event and this is not smoothing a
 * firehose. It is here so that a burst — four layers applied in one Save, a
 * paste, an undo held down — serialises the document once instead of once per
 * command. Short enough that the gap is hard to lose anything real in, and the
 * provider's `pagehide` flush closes it at the moment the page actually goes
 * away.
 */
export const DRAFT_DEBOUNCE_MS = 400;

export interface Draft {
  /** epoch ms the draft was written */
  readonly savedAt: number;
  readonly document: DocumentData;
  /**
   * The saved plan this drawing came out of, if any.
   *
   * Carried here because it has to survive the same reload the drawing does.
   * Without it, reopening the tab leaves the editor holding a drawing it can
   * no longer match to a slot, and the next Save writes a new one — or worse,
   * over whichever plan the name box happened to prefill from.
   */
  readonly projectId: string | null;
}

/**
 * Which saved plan is open, for everything that needs to ask during a session.
 *
 * A store rather than a read of the draft, because the answer changes on Open
 * and Save — moments that have nothing to do with the document changing — and
 * the sheet has to show it immediately. It is hydrated from the draft at
 * start-up and written back into every draft after that.
 */
export const openProjectStore = new ValueStore<string | null>(null);

/**
 * The draft, or null when there is nothing to restore.
 *
 * Unreadable counts as nothing, for the reason `readProjects` says: this is a
 * browser store the user also clears, and a corrupt key must not be able to
 * stop the editor opening. A draft that cannot be read costs one restore; a
 * throw here costs the whole app.
 */
export function readDraft(store: Storage): Draft | null {
  try {
    const raw = store.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    const draft = parsed as Draft;
    if (typeof draft.savedAt !== 'number' || !draft.document) return null;
    return {
      savedAt: draft.savedAt,
      document: draft.document,
      projectId: typeof draft.projectId === 'string' ? draft.projectId : null,
    };
  } catch {
    return null;
  }
}

/**
 * Keep the drawing as it stands.
 *
 * Reports failure rather than raising it. A draft that could not be written —
 * a full quota, a browser in private mode — must not take down the edit that
 * triggered it; the user carries on drawing, and the worst case is the one
 * they already had before any of this existed.
 */
export function writeDraft(store: Storage, draft: Draft): boolean {
  try {
    store.setItem(DRAFT_KEY, JSON.stringify(draft));
    return true;
  } catch {
    return false;
  }
}

/**
 * Forget the draft.
 *
 * Called when the drawing is deliberately replaced — a new starter plan — so
 * the next reload does not restore the thing the user just chose to leave.
 */
export function clearDraft(store: Storage): void {
  try {
    store.removeItem(DRAFT_KEY);
  } catch {
    /* a store that will not delete is a store that will not write either */
  }
}
