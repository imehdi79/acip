import type {
  DrawingDocument,
  EntityId,
  LayerRefs,
  MaterialUnit,
  Phase,
} from '@acip/editor-core';
import { WallEntity, layerQuantity } from '@acip/editor-core';
import { computeFinishTakeoff } from '@acip/estimator';
import type { EstimatorStep } from './estimator-steps';

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
 * The finishes on ONE face of one wall, in the order they were added.
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
export function finishesOnFace(
  doc: DrawingDocument,
  wallId: EntityId,
  side: FaceSide,
): FinishRow[] {
  const anchor = anchorForSide(side);
  const onThisFace = doc.relations
    .relationsOfHost(wallId)
    .filter((relation) => relation.anchorIndex === anchor)
    .map((relation) => relation.hostedId);
  if (onThisFace.length === 0) return [];

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

    // Demolition is the same area priced as a strip-out, never as tiles: you
    // do not count the tiles you are tearing off a wall. Straight from the
    // BOQ, so a demolish row shows the number the bill will carry.
    if (finish.phase === 'demolish') {
      rows.push({
        id,
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

/**
 * Where a step's build-up can actually be written.
 *
 * A finish is a hosted entity, and core hosts it on a WALL FACE or a SLAB and
 * nowhere else. So most of what the walk turns up cannot hold one, and this
 * says which and why instead of the sheet offering an Add button that would
 * have nothing to dispatch.
 */
export type FinishTarget =
  | { readonly kind: 'wall'; readonly wallId: EntityId }
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
  if (step.kind === 'room') {
    // A room is derived from wall geometry and is not an entity, so there is
    // nothing to host on. Core puts a floor finish on the SLAB under the room
    // (FLOORFINISH.ADD) — which means finding or making one, and making one is
    // a change to the drawing that nobody asked for by opening a sheet.
    return {
      kind: 'none',
      reason:
        'A room is finished through the slab under it, which is not wired up yet.',
    };
  }
  return {
    kind: 'none',
    reason: `A finish sits on a wall face, so a ${spoken(step.kind)} cannot carry one yet.`,
  };
}
