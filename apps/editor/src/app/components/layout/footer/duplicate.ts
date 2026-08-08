import type { EditorSession, EntityId } from '@acip/editor-core';
import type { EditorUi } from '@/editor/ui-state';

/** gap between an original and its copy, in metres */
const COPY_GAP = 1;

/**
 * Copy the selection and hand the copies over as the new selection — so the
 * next thing you do (drag, delete, duplicate again) applies to the copy, which
 * is what "duplicate" means everywhere else.
 *
 * The copy lands to the right of the original rather than on top of it: two
 * walls at the same coordinates would join into one another and be impossible
 * to tell apart on a phone screen.
 */
export function duplicateSelection(session: EditorSession, ui: EditorUi): void {
  const ids = session.selection.list();
  if (ids.length === 0) return;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const id of ids) {
    const entity = session.doc.get(id);
    if (!entity) continue;
    const b = entity.getBounds();
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return;

  const dx = maxX - minX + COPY_GAP;
  const copies = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
    ids,
    delta: { x: dx, y: 0 },
  });

  session.selection.clear();
  for (const id of copies) session.selection.add(id);
  // frame original and copy together, so the copy cannot appear off-screen
  ui.requestFit({ minX, minY, maxX: maxX + dx, maxY });
}
