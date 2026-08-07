import type { EntityId, LevelId } from '../common/id.js';
import type { DrawingDocument } from '../document/document.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import type { SpaceInfo } from '../measurements/spaces.js';
import { detectSpaces } from '../measurements/spaces.js';

/**
 * What the current selection amounts to, for chrome that changes with it
 * (contextual toolbars, property panels, agent prompts).
 *
 * `kind` is deliberately not an enum of known types: apart from the three
 * reserved values it IS the entity's own `type` string, so a new entity type
 * classifies correctly the day it exists, with no change here.
 */
export interface SelectionInfo {
  readonly ids: readonly EntityId[];
  readonly count: number;
  /** distinct entity types present, sorted; empty when nothing is selected */
  readonly types: readonly string[];
  /**
   * `'none'` when empty, `'room'` when the selection is exactly a detected
   * space's boundary walls, `'mixed'` when types differ, otherwise the single
   * shared entity type (`'wall'`, `'door'`, `'stair'`, …).
   */
  readonly kind: string;
  /** the space whose boundary walls this selection is, else null */
  readonly space: SpaceInfo | null;
}

const EMPTY: SelectionInfo = {
  ids: [],
  count: 0,
  types: [],
  kind: 'none',
  space: null,
};

/**
 * The space whose boundaryWallIds are exactly `ids`, or null.
 *
 * Spaces are derived on every read and there is no cache on the document, so
 * only the caller's wall-only guard keeps this off the hot path.
 */
function spaceFor(
  doc: DrawingDocument,
  ids: readonly EntityId[],
  levelId: LevelId | null,
): SpaceInfo | null {
  const want = new Set(ids);
  for (const space of detectSpaces(doc, levelId)) {
    if (space.boundaryWallIds.length !== want.size) continue;
    if (space.boundaryWallIds.every((id) => want.has(id))) return space;
  }
  return null;
}

/**
 * Classify a selection. Ids that no longer resolve are ignored, so a stale
 * selection degrades to whatever still exists rather than throwing.
 */
export function classifySelection(
  doc: DrawingDocument,
  ids: readonly EntityId[],
  levelId: LevelId | null = null,
): SelectionInfo {
  const live: EntityId[] = [];
  const types = new Set<string>();
  let walls = 0;
  for (const id of ids) {
    const entity = doc.get(id);
    if (!entity) continue;
    live.push(id);
    types.add(entity.type);
    if (entity instanceof WallEntity) walls++;
  }
  if (live.length === 0) return EMPTY;

  // A room is a loop of walls, so anything else rules it out before the
  // arrangement is ever built. Two walls cannot bound a region.
  const space =
    walls === live.length && walls >= 3 ? spaceFor(doc, live, levelId) : null;

  const sorted = [...types].sort();
  const kind = space ? 'room' : sorted.length === 1 ? sorted[0] : 'mixed';

  return {
    ids: live,
    count: live.length,
    types: sorted,
    kind,
    space,
  };
}
