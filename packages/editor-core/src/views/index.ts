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

/** hidden layers hide their entities everywhere (render, snap, export) */
export function isEntityVisible(doc: DrawingDocument, entity: Entity): boolean {
  return doc.getLayer(entity.layerId)?.visible !== false;
}

/** pickable/editable: visible AND the layer is not locked */
export function isEntityInteractive(
  doc: DrawingDocument,
  entity: Entity,
): boolean {
  const layer = doc.getLayer(entity.layerId);
  return layer?.visible !== false && layer?.locked !== true;
}

export function entitiesInView(
  doc: DrawingDocument,
  view: ViewDefinition,
): Entity[] {
  if (view.kind === '3d') {
    return doc.all().filter((e) => isMeshable(e));
  }
  if (view.levelId === null) return doc.all();
  return doc.all().filter((e) => {
    if (!isLevelAware(e)) return true;
    // unassigned (null) entities show on every level
    return e.baseLevelId === null || e.baseLevelId === view.levelId;
  });
}
