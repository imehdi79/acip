import type { DrawingDocument, EntityId } from '@acip/editor-core';
import { HostedOpeningEntity } from '@acip/editor-core';
import type { FinishSpot } from './estimator-finishes';

/** one door or window in the wall a layer sits on */
export interface OpeningRow {
  readonly id: EntityId;
  /** what to call it — `Door D2`, `Window WN1` */
  readonly name: string;
  /** true when it is already marked for tear-out */
  readonly demolish: boolean;
}

/** the marks the plan draws beside each kind, so the sheet says the same word */
const MARK_PREFIX: Record<string, string> = { door: 'D', window: 'WN' };

function label(entity: HostedOpeningEntity): string {
  const kind = entity.type.charAt(0).toUpperCase() + entity.type.slice(1);
  if (entity.mark === undefined) return kind;
  return `${kind} ${MARK_PREFIX[entity.type] ?? ''}${entity.mark}`;
}

/**
 * The doors and windows in the wall this layer is on.
 *
 * A slab has none, and gets an empty list rather than a special case at the
 * call site: "what openings cross this floor" has an answer, and the answer is
 * none.
 *
 * They are read off the HOST, not off the face, because an opening goes
 * through a wall — it belongs to both faces at once. Side A and Side B
 * therefore offer the same doors, which is right: a door taken out is taken
 * out from both sides, and marking it twice from two tabs must not read as two
 * doors.
 *
 * Pure and React-free, so what the sheet offers for a given drawing can be
 * asserted from a session alone.
 */
export function openingsAt(
  doc: DrawingDocument,
  spot: FinishSpot,
): OpeningRow[] {
  if (spot.kind !== 'wall') return [];
  const rows: OpeningRow[] = [];
  for (const relation of doc.relations.relationsOfHost(spot.wallId)) {
    const entity = doc.get(relation.hostedId);
    if (!(entity instanceof HostedOpeningEntity)) continue;
    rows.push({
      id: entity.id,
      name: label(entity),
      demolish: entity.phase === 'demolish',
    });
  }
  return rows;
}
