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
/**
 * Commands that can leave two walls covering one stretch of plan, and so need
 * a resolve behind them.
 *
 * Adding a wall is the obvious one, but MOVING is how it actually happens in
 * practice: copy a room, drag it onto an existing wall, and the two land on
 * top of each other. Grip moves count too — dragging a wall's end into the
 * middle of another is exactly the "connect a room to a wall" case, and the
 * wall it lands on has to split there.
 */
export const OVERLAPPING_COMMANDS: ReadonlySet<string> = new Set([
  'WALL.ADD',
  'ENTITY.MOVE',
  'ENTITY.DUPLICATE',
  'GRIP.MOVE',
  'GRIP.MOVEMANY',
]);

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
