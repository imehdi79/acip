import type { EditorSession } from '@acip/editor-core';
import { WallEntity } from '@acip/editor-core';

/**
 * Curving and straightening walls from the footer.
 *
 * The sweep itself lives in core; what lives here is the answer to "what
 * should pressing the button DO", which is a UI question and has no business
 * in the geometry.
 */

/**
 * The curve a wall gets when it is first bent, in radians.
 *
 * A visible bow rather than a token one. The whole point of the button is to
 * show the wall has become something you can shape — a sweep too small to see
 * would read as the button being broken, and the user would press it again.
 * A quarter turn is unmistakably curved and still shallow enough to drag
 * either way from.
 */
export const DEFAULT_SWEEP = Math.PI / 6;

/** the walls in the selection, in selection order */
export function selectedWalls(session: EditorSession): WallEntity[] {
  const walls: WallEntity[] = [];
  for (const id of session.selection.list()) {
    const entity = session.doc.get(id);
    if (entity instanceof WallEntity) walls.push(entity);
  }
  return walls;
}

/** is every selected wall already curved? */
export function allCurved(walls: readonly WallEntity[]): boolean {
  return walls.length > 0 && walls.every((wall) => wall.isCurved());
}

/**
 * Toggle the selection between curved and straight, as ONE undo step.
 *
 * A toggle rather than two buttons, because the footer on a phone has no room
 * for two and the state is visible on the plan anyway — you can see whether
 * the wall is bent.
 *
 * A MIXED selection curves rather than straightens. Straightening would throw
 * away the curves already there, and undoing a press is cheap while getting a
 * shape back is not; the safe direction is the one that adds.
 */
export function toggleCurve(session: EditorSession): void {
  const walls = selectedWalls(session);
  if (walls.length === 0) return;
  const straighten = allCurved(walls);
  session.history.beginGroup();
  try {
    session.dispatch('WALL.SETARC', {
      ids: walls.map((wall) => wall.id),
      sweep: straighten ? 0 : DEFAULT_SWEEP,
    });
  } finally {
    session.history.endGroup();
  }
}
