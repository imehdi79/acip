import type {
  BBox,
  DrawingDocument,
  EditorSession,
  EntityId,
  Point,
} from '@acip/editor-core';
import {
  bboxExpand,
  bboxUnion,
  isEntityVisible,
  point,
} from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';
import { withResolvedWalls } from '@/editor/walls';

/** gap between an original and its copy, in metres */
const COPY_GAP = 1;

/** how much empty ground a spot needs around it to count as free, in metres */
const CLEARANCE = 0.5;

/** which way to look, in order: right, below, left, above */
const DIRECTIONS: readonly Point[] = [
  point(1, 0),
  point(0, -1),
  point(-1, 0),
  point(0, 1),
];

/** how many slots out the search goes before it settles for the default */
const MAX_RINGS = 8;

/** the box the selection occupies, or null when there is nothing to copy */
export function selectionBounds(
  doc: DrawingDocument,
  ids: readonly EntityId[],
): BBox | null {
  let bounds: BBox | null = null;
  for (const id of ids) {
    const entity = doc.get(id);
    if (!entity) continue;
    const b = entity.getBounds();
    bounds = bounds === null ? b : bboxUnion(bounds, b);
  }
  return bounds;
}

const shift = (b: BBox, by: Point): BBox => ({
  minX: b.minX + by.x,
  minY: b.minY + by.y,
  maxX: b.maxX + by.x,
  maxY: b.maxY + by.y,
});

/**
 * Is this spot empty, counting the selection itself as not in the way?
 *
 * Only what is on the screen can be in the way. A copy that dodges around
 * hidden work lands in a gap the user cannot account for, which is worse than
 * landing where the ground looks clear.
 */
function isFree(
  doc: DrawingDocument,
  spot: BBox,
  selected: ReadonlySet<EntityId>,
): boolean {
  const room = bboxExpand(spot, CLEARANCE);
  return doc
    .queryBBox(room)
    .every(
      (entity) => selected.has(entity.id) || !isEntityVisible(doc, entity),
    );
}

/**
 * Where to drop the copy: the first slot around the original — right, below,
 * left, above, then one slot further out in the same order — with nothing
 * already standing in it.
 *
 * The old fixed shift to the right was predictable but blind, so on any plan
 * with a neighbour the copy landed on top of it and the user was left staring
 * at two things in one place wondering what had happened.
 *
 * A slot is one bbox plus a gap, so the search walks in the same units the
 * copy occupies and the result stays on a tidy grid rather than hunting for
 * the nearest crack it fits into.
 */
export function planDuplicateOffset(
  doc: DrawingDocument,
  ids: readonly EntityId[],
): Point {
  const bounds = selectionBounds(doc, ids);
  if (bounds === null) return point(0, 0);

  const stepX = bounds.maxX - bounds.minX + COPY_GAP;
  const stepY = bounds.maxY - bounds.minY + COPY_GAP;
  const selected = new Set(ids);

  for (let ring = 1; ring <= MAX_RINGS; ring++) {
    for (const dir of DIRECTIONS) {
      const offset = point(dir.x * stepX * ring, dir.y * stepY * ring);
      if (isFree(doc, shift(bounds, offset), selected)) return offset;
    }
  }
  // Hemmed in on all sides: the copy still has to go somewhere, and the search
  // is bounded on purpose — a phone tap that thinks for a second is worse than
  // one that puts the copy where duplicate has always put it.
  return point(stepX, 0);
}

/**
 * Copy the selection and hand the copies over as the new selection — so the
 * next thing you do (drag, delete, duplicate again) applies to the copy, which
 * is what "duplicate" means everywhere else.
 *
 * The copy lands in free space near the original rather than on top of it: two
 * walls at the same coordinates would join into one another and be impossible
 * to tell apart on a phone screen.
 */
export function duplicateSelection(session: EditorSession, ui: EditorUi): void {
  const ids = session.selection.list();
  const bounds = selectionBounds(session.doc, ids);
  if (bounds === null) return;

  const delta = planDuplicateOffset(session.doc, ids);
  // the chosen spot is clear, but the fallback one is not — resolve so a copy
  // dropped on a crowded plan never doubles up on an existing wall
  const copies = withResolvedWalls(session, () =>
    session.dispatch<EntityId[]>('ENTITY.DUPLICATE', { ids, delta }),
  );

  session.selection.clear();
  for (const id of copies) session.selection.add(id);
  // frame original and copy together, so the copy cannot appear off-screen
  ui.requestFit(bboxUnion(bounds, shift(bounds, delta)));
}
