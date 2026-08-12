import type { DrawingDocument, SpaceInfo } from '@acip/editor-core';
import { findSpaceTag, isEntityVisible, spaceName } from '@acip/editor-core';

/**
 * The name to show for a room, or null when it has none to show.
 *
 * A room's name is a stored tag entity, and a tag sits on a layer like
 * everything else — so a name written while the danger zone was open is on the
 * zone's layer and disappears with it. Core answers the model question ("what
 * is this room called"); this answers the view's ("what may be read off the
 * plan"), and both the canvas and the estimator have to answer it the same way
 * or the drawing and the walk-through disagree about a room's name.
 */
export function visibleSpaceName(
  doc: DrawingDocument,
  space: SpaceInfo,
): string | null {
  const tag = findSpaceTag(doc, space);
  if (!tag || !isEntityVisible(doc, tag)) return null;
  return spaceName(doc, space);
}
