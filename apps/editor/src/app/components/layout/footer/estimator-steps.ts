import type {
  BBox,
  DrawingDocument,
  Entity,
  EntityId,
  LevelId,
  SpaceInfo,
} from '@acip/editor-core';
import {
  HostedOpeningEntity,
  SpaceTagEntity,
  WallEntity,
  bboxFromPoints,
  detectSpaces,
  entitiesInView,
  isEntityVisible,
} from '@acip/editor-core';
import { visibleSpaceName } from '@/editor/spaces';

/** One shape to walk past — an entity, or a room derived from the walls. */
export interface EstimatorStep {
  /** stable identity: the entity id, or the space's centroid key */
  readonly id: string;
  /** the entity's own type, or `'room'` for a derived space */
  readonly kind: string;
  /** what the step shows, e.g. `Wall W3` or `Room — Kitchen` */
  readonly name: string;
  /**
   * Where the shape sits in the plan, so the wizard can send the camera to it.
   * Part of the step rather than looked up in the component: "what does this
   * step point at" is the same decision as "what does this step name", and it
   * belongs with it — testable from a document, with no React in the way.
   */
  readonly bounds: BBox;
  /**
   * What to select so the shape lights up under the camera. One entity for
   * most steps; a ROOM is derived and cannot itself be selected, so it is its
   * boundary walls — the same thing a tap inside a room selects.
   */
  readonly entityIds: readonly EntityId[];
}

/**
 * The marks the plan itself draws next to each shape (scene-renderer owns the
 * same map). Deliberately a *naming* table, not a list of what counts as a
 * shape: a type missing from it still gets a step, just with a bare number.
 */
const MARK_PREFIX: Record<string, string> = {
  wall: 'W',
  door: 'D',
  window: 'WN',
  slab: 'SL',
  roof: 'RF',
  stair: 'ST',
  finish: 'FN',
};

/** `curtain-wall` → `Curtain wall` */
function typeLabel(type: string): string {
  const words = type.replace(/[-_]/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function entityStep(entity: Entity): EstimatorStep {
  const label = typeLabel(entity.type);
  return {
    id: entity.id as string,
    kind: entity.type,
    // an entity restored from data can be mark-less; the type alone still
    // names it rather than reading as "Wall undefined"
    name:
      entity.mark === undefined
        ? label
        : `${label} ${MARK_PREFIX[entity.type] ?? ''}${entity.mark}`,
    // effective geometry, so a wall is the box the PLAN draws (openings cut,
    // ends mitered into their junctions) rather than its bare baseline
    bounds: entity.getBounds(),
    entityIds: [entity.id],
  };
}

/**
 * Where a room is. A room is not an entity and has no getBounds() to ask, so
 * the box comes from its loop — the GROSS one, along the wall centerlines, so
 * the walls that make it a room are inside the frame instead of cropped at the
 * plaster. Detection always returns a loop; the label anchor is the honest
 * fallback for the case where one day it does not.
 */
function spaceBounds(space: SpaceInfo): BBox {
  const loop = space.grossBoundary.length
    ? space.grossBoundary
    : space.boundary;
  return bboxFromPoints(loop.length > 0 ? loop : [space.labelPoint]);
}

/**
 * Reading order within a run: by type, then by the mark the user sees on the
 * plan, so stepping follows the numbers rather than creation order. The id
 * breaks the remaining ties (mark-less entities), which is what keeps the
 * sequence identical between two renders of the same document.
 */
function byMark(a: Entity, b: Entity): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  const am = a.mark ?? Number.POSITIVE_INFINITY;
  const bm = b.mark ?? Number.POSITIVE_INFINITY;
  if (am !== bm) return am - bm;
  return (a.id as string) < (b.id as string) ? -1 : 1;
}

/**
 * Every shape on a level, in the order the estimator walks them.
 *
 * Pure and React-free on purpose — the whole "what is there to price" decision
 * lives here, testable from a document alone (the resolveFooter pattern).
 *
 * Structure first, then the things hosted in it: walls, the rooms they enclose,
 * the openings cut into them, then everything else. Rooms are NOT entities —
 * they are derived from wall geometry on every read — so they come from
 * detectSpaces, and `visibleOnly` keeps the wizard to the rooms the user can
 * actually see on the plan.
 *
 * Nothing here enumerates entity types: membership is "whatever is in the
 * document on this level", so a new type shows up without a change here. The
 * one exclusion is the space tag, which stores a room's NAME and draws no
 * linework — it is not a shape, and it already appears as its room's name.
 */
export function estimatorSteps(
  doc: DrawingDocument,
  levelId: LevelId | null,
): EstimatorStep[] {
  const walls: Entity[] = [];
  const openings: Entity[] = [];
  const rest: Entity[] = [];

  for (const entity of entitiesInView(doc, { kind: 'plan', levelId })) {
    if (entity instanceof SpaceTagEntity) continue;
    if (!isEntityVisible(doc, entity)) continue; // a hidden layer hides it everywhere
    if (entity instanceof WallEntity) walls.push(entity);
    // by base class, so a future kind of opening sorts with the openings
    else if (entity instanceof HostedOpeningEntity) openings.push(entity);
    else rest.push(entity);
  }

  const rooms = detectSpaces(doc, levelId, { visibleOnly: true }).map(
    (space) => {
      // the name the PLAN shows: a tag on a hidden layer names nothing, and
      // the wizard must not read a room a name the drawing does not carry
      const name = visibleSpaceName(doc, space);
      return {
        id: space.key,
        kind: 'room',
        // an unnamed room has nothing to call it but its size
        name: name ? `Room — ${name}` : `Room ${space.netArea.toFixed(1)} m²`,
        bounds: spaceBounds(space),
        // a room is derived and has no id to select, so it lights up the way a
        // tap inside one does: through the walls that bound it
        entityIds: space.boundaryWallIds,
      };
    },
  );

  return [
    ...walls.sort(byMark).map(entityStep),
    ...rooms,
    ...openings.sort(byMark).map(entityStep),
    ...rest.sort(byMark).map(entityStep),
  ];
}
