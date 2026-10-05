import type { EditorSession } from '@acip/editor-core';
import { loadDocumentInto } from '@acip/editor-core';
import { openProjectStore, writeDraft } from '@/data/draft';
import { applyProjectLayerDefaults } from '@/data/layer-defaults';
import { applyProjectRates } from '@/data/rates';
import type { SavedProject } from '@/data/projects';

/**
 * Put a saved plan back on screen — the whole of it, not just the drawing.
 *
 * Two screens open plans now: the header's Open sheet, and the Recent list on
 * the selector. Opening is five steps that have to happen together and in
 * order, and a second copy of them would drift on the first one that gained a
 * sixth — the drawing would arrive somewhere priced at another job's rates, or
 * attached to no slot, which is the bug class this exists to close.
 *
 * It deliberately does NOT move the camera or change the view. Where the user
 * ends up afterwards differs per caller — the sheet is already in the editor
 * and only needs a refit, the selector has to navigate — and that is the one
 * part of this that is genuinely not shared.
 */
export function openSavedPlan(
  session: EditorSession,
  project: SavedProject,
  store: Storage,
): void {
  // `newDocument` FIRST: loadDocumentInto ADDS to whatever is already there, so
  // loading over a live plan would merge the two — and `levels.add` throws on
  // an id it has already seen, which is a plan that opens once and then
  // refuses. Same session throughout, because a new one would orphan every
  // subscription the viewport and footer already hold.
  session.newDocument();
  loadDocumentInto(session.doc, project.document, session.entityTypes);

  // the prices it was quoted at, over this device's own table. A plan saved
  // before prices travelled carries none and gets the device table alone —
  // which is exactly what it was priced against at the time.
  applyProjectRates(project.rates ?? {}, store);
  applyProjectLayerDefaults(project.defaults ?? {}, store);

  // this drawing belongs to that slot again, and the draft has to agree or a
  // reload would hand it back unattached and the next Save would fork it
  openProjectStore.set(project.id);
  writeDraft(store, {
    savedAt: Date.now(),
    document: project.document,
    projectId: project.id,
  });

  session.selection.clear();
}
