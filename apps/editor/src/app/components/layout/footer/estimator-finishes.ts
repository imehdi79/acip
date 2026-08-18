import type {
  DrawingDocument,
  EntityId,
  LayerRefs,
  MaterialUnit,
  Phase,
} from '@acip/editor-core';
import {
  FinishEntity,
  SlabEntity,
  WallEntity,
  bboxFromPoints,
  layerQuantity,
} from '@acip/editor-core';
import { computeFinishTakeoff } from '@acip/estimator';
import type { EstimatorStep } from './estimator-steps';
import {
  ensureSlabUnder,
  slabUnderRoom,
  type Dispatch,
  type RoomFootprint,
} from './estimator-slabs';

/**
 * Which face of a wall — core's own word for it.
 *
 * The sheet says "Side A"/"Side B" because the estimator cannot know which
 * face of a given wall points outdoors, but what it WRITES is `face+`/`face-`,
 * because that is what `FINISH.ADD` takes and what the relation graph anchors
 * against. The two vocabularies meet here and nowhere else.
 */
export type FaceSide = 'face+' | 'face-';

/**
 * Which surface of a slab — core's own word again.
 *
 * A slab's top is the floor of the room standing on it and its underside is
 * that room's ceiling, so `FLOORFINISH.ADD` takes `top`/`bottom` where the
 * sheet says "Floor"/"Ceiling". Unlike the wall's A and B, these two words are
 * never wrong about the world: which way is up is not a question the estimator
 * has to guess at.
 */
export type SlabSurface = 'top' | 'bottom';

/**
 * face+ → anchor 1, face- → anchor 2 in `WallEntity.getAnchors()`.
 *
 * Mirrors `anchorIndexForSide` in core's `commands/finishes.ts`. It is copied
 * rather than imported because core does not export it — and it is asserted in
 * a test that adds a finish through the command and reads it back through this
 * function, so the copy cannot quietly drift from the original.
 */
export function anchorForSide(side: FaceSide): number {
  return side === 'face+' ? 1 : 2;
}

/**
 * top (floor) → anchor 0, bottom (ceiling) → anchor 1 on a slab.
 *
 * Mirrors `anchorIndexForSurface` in the same unexported corner of core, and
 * pinned by the same kind of round-trip test. Note that these are NOT the wall
 * numbers offset by one and they overlap them: anchor 1 is a wall's `face+`
 * and a slab's underside. Read the wrong table and a floor finish lands on a
 * ceiling — which is why the two anchor functions take disjoint argument
 * types, and why nothing in this app maps a bare string into either.
 */
export function anchorForSurface(surface: SlabSurface): number {
  return surface === 'bottom' ? 1 : 0;
}

/**
 * The two tabs a WALL step shows, as the sheet's own ids.
 *
 * "Side A" and "Side B" rather than "Inside"/"Outside": the estimator has no
 * idea which face of a given wall faces out — an internal partition has two
 * insides — so those words would be a label that is sometimes simply wrong.
 */
export type WallSide = 'a' | 'b';

/**
 * The two tabs a ROOM step shows.
 *
 * A room used to get one list and no tabs, on the reasoning that a room is a
 * volume rather than a face and has no second copy of its layers to hide
 * behind a tab. That was wrong in the way that matters to a bill: the floor
 * build-up and the ceiling build-up are different trades, priced against
 * different surfaces of the same slab, and one list forced them into a single
 * stack that the document then had to split again on the way out.
 */
export type RoomSide = 'floor' | 'ceiling';

/** every tab id the walk can show — the union the sheet's state is drawn from */
export type StepSide = WallSide | RoomSide;

/**
 * A resolved place to read or write a build-up: a host AND its surface,
 * together, in one value.
 *
 * This is what replaced `sideToFace(side: string)`. That function mapped a tab
 * id onto a wall face, which was fine while a wall face was the only place a
 * finish could go; extending it to slabs would have meant a second function of
 * the same shape, and two functions from `string` to two different vocabularies
 * is an invitation to hand `'a'` to the slab one and quietly finish a ceiling
 * instead of a floor. Nothing in the type of a bare `'a'` can stop that.
 *
 * So no caller maps a side any more. A spot is built once, from a target that
 * already knows its host, and it carries `slabId` and `surface` in the SAME
 * arm — there is no way to reach `FLOORFINISH.ADD` holding a wall face,
 * because the value that gets you there does not have one. The mistake stopped
 * being a bug to test for and became a compile error.
 */
export type FinishSpot =
  | {
      readonly kind: 'wall';
      readonly wallId: EntityId;
      readonly side: FaceSide;
    }
  | {
      readonly kind: 'slab';
      readonly slabId: EntityId;
      readonly surface: SlabSurface;
    };

/**
 * The rectangle a finish covers, in METRES, however its host stores it.
 *
 * This is where the estimating judgement actually lives: "tile to 1.2 m, paint
 * above" is two finishes on one face distinguished by nothing but their
 * extents. It is stated as a width and a height because that is what an
 * estimator measures and what a tape reads — the document's own vocabulary is
 * two different things underneath and neither is a number anyone says out
 * loud. A wall band is `[t0, t1]` along the wall and `[sill, top]` up it,
 * anchored so it follows the wall; a floor is an unanchored rectangle on the
 * plan. `coverPatch` is the only place either is written, so the sheet never
 * has to know which it is looking at.
 *
 * The rest of the fields are what that translation needs, kept here rather
 * than in the component so the arithmetic is testable without a DOM.
 */
export interface FinishCover {
  /** metres along the wall, or across the plan for a floor */
  readonly width: number;
  /** metres up the wall, or across the plan for a floor */
  readonly height: number;
  readonly host: 'wall' | 'slab';
  /** wall only: where the band starts, which the width is measured FROM */
  readonly t0: number;
  /** wall only: the foot of the band, which the height is measured FROM */
  readonly sillHeight: number;
  /** wall only: the wall's own length, to turn a width in metres back into t1 */
  readonly hostLength: number;
}

/**
 * What to send FINISH.UPDATE to make the cover this wide, or this tall.
 *
 * The one place the sheet's metres become the document's own extent, and the
 * reason the component knows nothing about `t1` or `coverHeight`. Width and
 * height are anchored at the START of the band, not centred: an estimator
 * typing 1.2 m over a dado means "1.2 m up from where it begins", and moving
 * the foot of a band the user did not touch would be an edit they did not ask
 * for.
 *
 * A slab needs BOTH halves whatever changed, because core refuses half a
 * rectangle — one dimension alone cannot say what area is covered.
 */
export function coverPatch(
  cover: FinishCover,
  next: { readonly width?: number; readonly height?: number },
): Record<string, number> {
  const width = next.width ?? cover.width;
  const height = next.height ?? cover.height;
  if (cover.host === 'slab') {
    return { coverWidth: width, coverHeight: height };
  }
  const patch: Record<string, number> = {};
  if (next.width !== undefined && cover.hostLength > 0) {
    patch['t1'] = cover.t0 + width / cover.hostLength;
  }
  if (next.height !== undefined) {
    patch['topHeight'] = cover.sillHeight + height;
  }
  return patch;
}

/** one finish on one face, resolved into what the sheet shows */
export interface FinishRow {
  readonly id: EntityId;
  /** the material it applies, so the add sheet can refuse to apply it twice */
  readonly materialId: string | null;
  /** the material's name — what the row is called */
  readonly name: string;
  /** the unit the quantity comes out in, which the material decides */
  readonly unit: MaterialUnit | 'm2';
  /** the key a rate table will be looked up by */
  readonly costCode: string;
  /** finished band area with overlapping openings already subtracted (m²) */
  readonly area: number;
  /** covered length along the wall (m) */
  readonly length: number;
  /** the number the BOQ will price, in `unit` */
  readonly quantity: number;
  readonly phase: Phase;
  /** true when the finish has no material — nothing to price it by */
  readonly unpriced: boolean;
  /** its own build-up thickness (m); only an m³ material bills on it */
  readonly thickness: number;
  /**
   * The rectangle it covers, in metres, ready to be typed over.
   *
   * Null only when the host is neither a wall nor a slab, which nothing in the
   * walk currently is — the sheet still guards, because a row with nowhere to
   * write is better shown without inputs than with ones that throw on save.
   */
  readonly cover: FinishCover | null;
  /**
   * Whether the openings crossing this layer come out of its area.
   *
   * A wall-face question only: a slab has no openings, and core rejects the
   * flag for one rather than letting it be set where it could do nothing.
   */
  readonly deductOpenings: boolean;
}

/**
 * Cost code for a strip-out, the "demolition is a finish in reverse"
 * convention: `wall-tile` → `demo-wall-tile`. Copied from the BOQ's own
 * `demoCode` for the same reason `anchorForSide` is.
 */
function demoCode(baseCode: string | null): string {
  return baseCode ? `demo-${baseCode}` : 'demo-finish';
}

/**
 * The finishes hosted on one host at one anchor, in the order they were added.
 *
 * The whole body of the old `finishesOnFace` lives here, unchanged, because a
 * wall face and a slab surface differ only in which anchor number they are —
 * everything after that (creation order, the takeoff lookup, the demolition
 * branch, the quantity) is host-agnostic, exactly as core promises: "the
 * estimator and quantities read `getNetArea()` without knowing which host it
 * sits on". Sharing the body rather than writing a slab version beside it is
 * what guarantees a floor's rows are numbered by the same rule as a wall's,
 * and that a slab row can never drift into reporting a different number from
 * the one the bill carries.
 *
 * Order is creation order, which is what the relation graph hands back: a
 * finish carries no rank of its own, so the number on each row describes the
 * order the user built the stack up in and nothing more. Reordering would need
 * somewhere to put the answer, which the document does not have yet.
 *
 * The numbers come from `computeFinishTakeoff` rather than being worked out
 * here, and the quantity mirrors the BOQ's own arithmetic line for line. That
 * is the whole point: the sheet is a view onto the estimate, and a face that
 * reads 12.4 m² here and 11.9 m² in the bill is worse than a face that reads
 * nothing at all.
 */
function finishesAtAnchor(
  doc: DrawingDocument,
  hostId: EntityId,
  anchor: number,
): FinishRow[] {
  const onThisFace = doc.relations
    .relationsOfHost(hostId)
    .filter((relation) => relation.anchorIndex === anchor)
    .map((relation) => relation.hostedId);
  if (onThisFace.length === 0) return [];

  // asked once for the host rather than per finish, since every row on it
  // shares the same answer and the same dimensions to measure against
  const host = doc.get(hostId);
  const hostIsWall = host instanceof WallEntity;
  const hostLength = host instanceof WallEntity ? host.getLength() : 0;
  const hostHeight = host instanceof WallEntity ? host.getHeight() : 0;
  // a slab is an arbitrary polygon, so "how wide is the room" is its bounding
  // box — right on the rectangular rooms that are nearly all of them, and the
  // honest starting point for the rest, which the user then types over
  const slabBox =
    host instanceof SlabEntity
      ? bboxFromPoints([...host.getFootprint()])
      : null;

  // indexed, then walked in RELATION order — the takeoff comes back in document
  // order, which is not the order the user added things in
  const takeoff = new Map(
    computeFinishTakeoff(doc).map((finish) => [finish.entityId, finish]),
  );

  const rows: FinishRow[] = [];
  for (const id of onThisFace) {
    const finish = takeoff.get(id);
    if (!finish) continue; // hosted here but not a finish — an opening, say
    const layer = finish.layer;
    // straight off the entity: the takeoff reports what a finish MEASURES, not
    // the numbers it was measured from, and those are what an edit changes
    const entity = doc.get(id);
    let cover: FinishCover | null = null;
    if (entity instanceof FinishEntity) {
      if (hostIsWall) {
        cover = {
          width: Math.max(0, (entity.t1 - entity.t0) * hostLength),
          height: Math.max(
            0,
            (entity.topHeight ?? hostHeight) - entity.sillHeight,
          ),
          host: 'wall',
          t0: entity.t0,
          sillHeight: entity.sillHeight,
          hostLength,
        };
      } else if (slabBox) {
        cover = {
          // what it was told to cover, or the room as drawn until it is told
          width: entity.coverWidth ?? slabBox.maxX - slabBox.minX,
          height: entity.coverHeight ?? slabBox.maxY - slabBox.minY,
          host: 'slab',
          t0: 0,
          sillHeight: 0,
          hostLength: 0,
        };
      }
    }
    const editable = {
      thickness: finish.thickness,
      cover,
      deductOpenings:
        entity instanceof FinishEntity ? entity.deductOpenings : true,
    };

    // Demolition is the same area priced as a strip-out, never as tiles: you
    // do not count the tiles you are tearing off a wall. Straight from the
    // BOQ, so a demolish row shows the number the bill will carry.
    if (finish.phase === 'demolish') {
      rows.push({
        id,
        ...editable,
        materialId: layer?.materialId ?? null,
        name: layer ? `Demolish ${layer.name}` : 'Demolish finish',
        unit: 'm2',
        costCode: demoCode(layer?.costCode ?? null),
        area: finish.area,
        length: finish.length,
        quantity: finish.area,
        phase: finish.phase,
        unpriced: !layer,
      });
      continue;
    }

    // a finish whose material was never set, or was removed out from under it
    if (!layer) {
      rows.push({
        id,
        ...editable,
        materialId: null,
        name: 'Finish (no material)',
        unit: 'm2',
        costCode: 'finish-area',
        area: finish.area,
        length: finish.length,
        quantity: finish.area,
        phase: finish.phase,
        unpriced: true,
      });
      continue;
    }

    const refs: LayerRefs = {
      volume: finish.area * finish.thickness,
      area: finish.area,
      length: finish.length,
    };
    rows.push({
      id,
      ...editable,
      materialId: layer.materialId,
      name: layer.name,
      unit: layer.unit,
      costCode: layer.costCode,
      area: finish.area,
      length: finish.length,
      quantity: layerQuantity(
        layer.unit,
        finish.thickness,
        finish.thickness,
        refs,
        layer.coverage,
      ),
      phase: finish.phase,
      unpriced: false,
    });
  }
  return rows;
}

/** the finishes on ONE face of one wall, in the order they were added */
export function finishesOnFace(
  doc: DrawingDocument,
  wallId: EntityId,
  side: FaceSide,
): FinishRow[] {
  return finishesAtAnchor(doc, wallId, anchorForSide(side));
}

/**
 * The finishes on ONE surface of one slab — a room's floor, or its ceiling.
 *
 * The area behind these rows is the slab's whole footprint: core subtracts
 * openings from a wall band but a slab has no penetrations in V1, so a floor
 * reads the full room. That is the same number `FLOORFINISH.AUTO` would have
 * produced and the same one the bill will carry, which is the only property
 * the sheet actually needs to keep.
 */
export function finishesOnSurface(
  doc: DrawingDocument,
  slabId: EntityId,
  surface: SlabSurface,
): FinishRow[] {
  return finishesAtAnchor(doc, slabId, anchorForSurface(surface));
}

/** whatever is built up at a resolved spot, wall face or slab surface alike */
export function finishesAt(
  doc: DrawingDocument,
  spot: FinishSpot,
): FinishRow[] {
  return spot.kind === 'wall'
    ? finishesOnFace(doc, spot.wallId, spot.side)
    : finishesOnSurface(doc, spot.slabId, spot.surface);
}

/**
 * Where a step's build-up can actually be written.
 *
 * A finish is a hosted entity, and core hosts it on a WALL FACE or a SLAB and
 * nowhere else. So most of what the walk turns up cannot hold one, and this
 * says which and why instead of the sheet offering an Add button that would
 * have nothing to dispatch.
 *
 * A room takes two arms rather than one because a room reaches its slab
 * THROUGH a floor that may not have been laid yet, and the difference is not
 * cosmetic: `slab` can be read from immediately, while `room` has nothing to
 * read and will write its first layer only after making somewhere to put it.
 * Collapsing them into one arm with a nullable id would have put that
 * distinction in a null check at every call site instead of in the type.
 */
export type FinishTarget =
  | { readonly kind: 'wall'; readonly wallId: EntityId }
  /** a room whose floor is already laid — the slab is the host */
  | { readonly kind: 'slab'; readonly slabId: EntityId }
  /** a room with no slab under it yet; the first layer lays one */
  | { readonly kind: 'room'; readonly room: RoomFootprint }
  | { readonly kind: 'none'; readonly reason: string };

/** `curtain-wall` → `curtain wall`, for a sentence rather than a heading */
function spoken(type: string): string {
  return type.replace(/[-_]/g, ' ');
}

export function finishTargetFor(
  doc: DrawingDocument,
  step: EstimatorStep,
): FinishTarget {
  if (step.kind === 'wall') {
    const wall = doc.get(step.entityIds[0]);
    if (wall instanceof WallEntity) return { kind: 'wall', wallId: wall.id };
  }
  if (step.kind === 'room' && step.room) {
    // A room is derived from wall geometry and is not an entity, so there is
    // nothing to host on directly — core finishes it through the SLAB beneath
    // it, whose top is this room's floor and whose underside is its ceiling.
    // Found, and only made once the user says what the floor is built up from:
    // see `ensureSlabUnder` for why that is deferred and why it is not
    // SLAB.AUTO.
    const slabId = slabUnderRoom(doc, step.room);
    return slabId === null
      ? { kind: 'room', room: step.room }
      : { kind: 'slab', slabId };
  }
  return {
    kind: 'none',
    reason: `A finish sits on a wall face or a slab, so a ${spoken(step.kind)} cannot carry one.`,
  };
}

/**
 * The spot behind each tab of a step, keyed by the tab's own id.
 *
 * The ONE place a tab and a document surface are ever put side by side. It is
 * a table rather than a function of the side because a table can be read in
 * both directions and checked at a glance, and because building the spots from
 * a target means the host id is filled in from something that already knows
 * it: there is no moment at which a surface exists without its host.
 *
 * `room` yields nothing, and that is the honest answer — a room with no slab
 * has nowhere for a finish to be, so both its tabs read empty until one is
 * laid. `none` yields nothing for the same reason, though the sheet blocks
 * before it ever asks.
 */
export function spotsFor(
  target: FinishTarget,
): Partial<Record<StepSide, FinishSpot>> {
  if (target.kind === 'wall') {
    return {
      a: { kind: 'wall', wallId: target.wallId, side: 'face+' },
      b: { kind: 'wall', wallId: target.wallId, side: 'face-' },
    };
  }
  if (target.kind === 'slab') {
    return {
      floor: { kind: 'slab', slabId: target.slabId, surface: 'top' },
      ceiling: { kind: 'slab', slabId: target.slabId, surface: 'bottom' },
    };
  }
  return {};
}

/**
 * The spots to WRITE to — the same table, except that a room with no slab
 * under it gets one first.
 *
 * Separate from `spotsFor` because the two are asked at completely different
 * moments and only one of them may change the drawing. Reading happens on
 * every document change and on every step; writing happens once, when the user
 * has picked their materials and pressed save, which is the only point at
 * which a new slab is a consequence of something they did rather than of
 * something they looked at.
 *
 * The dispatch is a callback rather than a session so this stays a free
 * function over a document — testable by handing it a real session's own
 * `dispatch` and reading the result back out of the document, which is the
 * only way the anchor mapping actually gets held honest.
 */
export function spotsToWrite(
  doc: DrawingDocument,
  target: FinishTarget,
  dispatch: Dispatch,
): Partial<Record<StepSide, FinishSpot>> {
  if (target.kind !== 'room') return spotsFor(target);
  const slabId = ensureSlabUnder(doc, target.room, dispatch);
  // a boundary too degenerate to floor: nothing to write to, and nothing was
  // created trying
  return slabId === null ? {} : spotsFor({ kind: 'slab', slabId });
}
