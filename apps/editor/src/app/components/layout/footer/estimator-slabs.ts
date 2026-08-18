import type {
  DrawingDocument,
  EntityId,
  LevelId,
  Point,
} from '@acip/editor-core';
import { FinishEntity, SlabEntity, pointInLoop } from '@acip/editor-core';

/**
 * A room's own geometry, carried on its step so a slab can be found under it
 * — or made — later, without detecting the rooms a second time.
 *
 * A room is derived from wall geometry on every read: there is no room entity
 * and no id to look one up by. `detectSpaces` runs the whole plan arrangement
 * to produce them, so asking it again inside the sheet would re-arrange the
 * plan on every document change just to rediscover something the walk already
 * knew. Worse, it would rediscover it by MATCHING — the step's id is the
 * space's centroid key, and a key is a best-effort identity that moves when
 * the room does. Copying the two facts a slab needs out of detection, at the
 * moment the walk is built, is both cheaper and steadier than looking the room
 * up again.
 */
export interface RoomFootprint {
  /** the NET boundary, along the inner wall faces — what SLAB.AUTO floors */
  readonly boundary: readonly Point[];
  /**
   * A point known to be inside the net boundary — detection's own label
   * anchor, which is where a room's name is written and therefore already
   * guaranteed to land inside the room rather than in a corner of its bounding
   * box. It is how a slab is recognised as being under THIS room.
   */
  readonly inside: Point;
  readonly levelId: LevelId | null;
}

/**
 * Is this slab on the storey being walked?
 *
 * The same three-way rule core's own `FLOORFINISH.AUTO` uses, copied for the
 * same reason `anchorForSide` is copied: it is not exported, and a stricter
 * rule here would hide slabs that the floor macro would happily finish. The
 * leniency matters — a slab drawn before any level existed carries a null
 * `baseLevelId` and belongs to whatever storey is looking at it.
 */
function onLevel(slab: SlabEntity, levelId: LevelId | null): boolean {
  return (
    levelId === null ||
    slab.baseLevelId === null ||
    slab.baseLevelId === levelId
  );
}

/** does anything hosted on this slab turn out to be a finish? */
function carriesFinishes(doc: DrawingDocument, slabId: EntityId): boolean {
  return doc.relations
    .relationsOfHost(slabId)
    .some((relation) => doc.get(relation.hostedId) instanceof FinishEntity);
}

/** a slab that could be the one under a room, and the facts that rank it */
interface Candidate {
  readonly id: EntityId;
  /** already priced through — the strongest claim to being the room's slab */
  readonly priced: boolean;
  readonly area: number;
}

/**
 * Which of several slabs over the same point is the room's own.
 *
 * Three rules, in the order they matter:
 *
 * 1. **The one already carrying finishes wins.** This is the rule that makes
 *    the feature safe rather than merely tidy. Nothing stops a `SLAB.AUTO` run
 *    — from the command line, from an agent — dropping a second slab over a
 *    room that already has one; without this rule the sheet would silently
 *    switch to the newcomer and the user's build-up would vanish from view
 *    while sitting untouched in the document. Following the finishes means the
 *    walk keeps showing what the user actually priced.
 * 2. **Then the tightest fit.** A structural plate drawn on the building
 *    outline contains every room's label point; the room's own slab, built
 *    from its net boundary, is the smaller of the two. Screed and tile are
 *    priced per room, not per plate.
 * 3. **Then the id**, so two indistinguishable candidates resolve the same way
 *    on every render — the same tie-break `byMark` uses in the walk, and for
 *    the same reason: a list that reorders between two reads of one document
 *    is worse than a list in the wrong order.
 */
function tightest(a: Candidate, b: Candidate): number {
  if (a.priced !== b.priced) return a.priced ? -1 : 1;
  if (a.area !== b.area) return a.area - b.area;
  return (a.id as string) < (b.id as string) ? -1 : 1;
}

/**
 * The slab under a room, or null when nothing has been laid there yet.
 *
 * Point-in-polygon against the footprint rather than `SlabEntity.hitTest`,
 * which also answers true for a point merely NEAR the boundary: a tolerance is
 * exactly right for a thumb aiming at an edge and exactly wrong for "is this
 * room floored", where a room whose label happens to sit a few centimeters
 * outside a neighbour's slab would be answered with the neighbour's screed.
 *
 * Pure and React-free, so what the sheet resolves for a given drawing is
 * assertable from a session alone — the same reason `estimatorSteps` is.
 */
export function slabUnderRoom(
  doc: DrawingDocument,
  room: RoomFootprint,
): EntityId | null {
  const candidates: Candidate[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof SlabEntity)) continue;
    if (!onLevel(entity, room.levelId)) continue;
    if (!pointInLoop(room.inside, entity.getFootprint())) continue;
    candidates.push({
      id: entity.id,
      priced: carriesFinishes(doc, entity.id),
      area: entity.getArea(),
    });
  }
  if (candidates.length === 0) return null;
  return candidates.sort(tightest)[0].id;
}

/** the one thing this module needs a session for — kept as a callback so the
 * module stays testable with nothing but a document and a real session's
 * `dispatch`, and so nothing here has to know what a session is */
export type Dispatch = <R>(name: string, params: unknown) => R;

/**
 * The slab under a room, laid if it was not there already.
 *
 * ### Why this is not `SLAB.AUTO`
 *
 * `SLAB.AUTO` is the obvious answer and it is the wrong one. It regenerates:
 * every slab it previously made is removed and rebuilt from the current rooms,
 * and a removed slab takes its hosted finishes with it. So the macro that
 * exists to give every room a floor is also the one command that would wipe
 * every floor and ceiling build-up the user had entered — silently, in one
 * transaction, the next time anything asked for a slab. Running it on opening
 * the sheet, or on reaching a room, or on any render, all reduce to the same
 * accident with a different trigger.
 *
 * ### What this does instead
 *
 * `SLAB.ADD`, once, for the one room that needs one, from that room's own net
 * boundary — the polygon `SLAB.AUTO` would have used anyway. It is purely
 * additive: it creates a single entity and removes nothing, so there is no
 * state of the document in which calling it destroys a finish. A second run
 * finds the slab the first one made and returns it untouched, which is what
 * makes it safe to call on every add.
 *
 * ### The bonus: it comes out hand-placed, and that is a feature
 *
 * A slab made this way has `auto = false`, and `SLAB.AUTO` never touches
 * hand-placed slabs. So a room floored through the estimator survives a later
 * `SLAB.AUTO` from the command line or from an agent, with its build-up
 * intact. Marking it `auto` would have looked more honest — it was, after all,
 * created without being asked for — and would have handed the regenerate macro
 * a licence to delete the user's work.
 *
 * ### Why it is deferred to the first layer
 *
 * Nothing is created by looking. A slab is a real entity that draws in the
 * plan, prices as concrete in the bill and lands in the undo stack; walking
 * past a room must not leave one behind. It appears at the moment the user
 * says what the floor is built up from, where it is plainly a consequence of
 * what they just did.
 *
 * Returns null for a boundary too degenerate to floor — `SLAB.ADD` rejects
 * those, and a rejected dispatch inside a tap handler is an unhandled throw
 * out of a React event rather than a sheet that quietly does nothing.
 */
export function ensureSlabUnder(
  doc: DrawingDocument,
  room: RoomFootprint,
  dispatch: Dispatch,
): EntityId | null {
  const found = slabUnderRoom(doc, room);
  if (found !== null) return found;
  if (room.boundary.length < 3) return null;
  const params: { points: readonly Point[]; levelId?: LevelId } = {
    points: room.boundary,
  };
  // omitted rather than passed as null: SLAB.ADD reads an absent levelId as
  // "level-unassigned", which is the same thing the walk means by a null one
  if (room.levelId !== null) params.levelId = room.levelId;
  return dispatch<EntityId>('SLAB.ADD', params);
}
