import type { EditorSession } from '@acip/editor-core';

/** what WALL.RESOLVE reports back */
export interface WallResolveResult {
  readonly split: string[];
  readonly created: string[];
  readonly removed: string[];
}

/**
 * Run `body`, then heal any wall overlap it introduced, as ONE undo step.
 *
 * Drawing a wall across another leaves two entities covering the same stretch
 * of plan — doubled linework, doubled takeoff, two dimensions on one wall.
 * WALL.RESOLVE splits them at the crossing and hands each stretch to a single
 * wall; running it here means the document is never left in the doubled state
 * between commits, and the user still sees one wall added and undoes one wall.
 *
 * The resolve is a no-op when nothing overlaps, so this is safe to wrap around
 * every wall-creating action.
 */
export function withResolvedWalls<T>(session: EditorSession, body: () => T): T {
  session.history.beginGroup();
  try {
    const result = body();
    session.dispatch('WALL.RESOLVE', {});
    return result;
  } finally {
    session.history.endGroup();
  }
}
