import type { LevelId } from '../common/id.js';
import type { Entity } from '../entities/base/entity.js';
import { isLevelAware, isMeshable } from '../entities/base/capabilities.js';
import type { DrawingDocument } from '../document/document.js';

/**
 * One document, many views: a floor plan is a QUERY, not a drawing.
 * Viewports render Views, never the raw document.
 */
export type ViewDefinition =
  | { readonly kind: 'plan'; readonly levelId: LevelId | null }
  | { readonly kind: '3d' };

export function entitiesInView(doc: DrawingDocument, view: ViewDefinition): Entity[] {
  if (view.kind === '3d') {
    return doc.all().filter((e) => isMeshable(e));
  }
  if (view.levelId === null) return doc.all();
  return doc.all().filter((e) => {
    if (!isLevelAware(e)) return true;
    return e.baseLevelId === view.levelId;
  });
}
