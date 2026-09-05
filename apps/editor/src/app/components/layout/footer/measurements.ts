import type {
  DrawingDocument,
  EditorSession,
  LevelId,
} from '@acip/editor-core';
import { WallEntity, distance } from '@acip/editor-core';
import { formatLengthValue, lengthUnit, parseLength } from '@/editor/units';
import { planWallResize, resizeWallLength } from '@/editor/rooms';
import type { ResizeSpread } from '@/editor/rooms';
import { labelledWallLength } from '@/editor/viewport/wall-dimensions';
import type { MeasureMode } from '@/editor/ui-state';

export type MeasurementField = 'length' | 'height' | 'thickness';

/** what the three inputs hold; blank means "leave this alone" */
export type MeasurementEdits = Record<MeasurementField, string>;

/**
 * Which drawing the dialog is talking about — the level it is showing and
 * whether it is measuring outer extents or inner clear widths.
 *
 * Carried rather than assumed, because a wall's length is no longer a property
 * of the wall: the same wall reads 6.30 or 5.70 depending on a toggle in the
 * settings sheet, and the dialog is only trustworthy if it is reading the same
 * one the user is.
 */
export interface MeasureView {
  readonly levelId: LevelId | null;
  readonly mode: MeasureMode;
}

/** the selected walls, in selection order */
export function selectedWalls(session: EditorSession): WallEntity[] {
  const walls: WallEntity[] = [];
  for (const id of session.selection.list()) {
    const entity = session.doc.get(id);
    if (entity instanceof WallEntity) walls.push(entity);
  }
  return walls;
}

/**
 * The length this wall is LABELLED with on the plan, not its centreline. The
 * dialog has to agree with the number the user is reading off the drawing, or
 * "7.15 → 8.00" silently means something else.
 *
 * Which number that IS now depends on the view: the overall drawn extent, outer
 * corner to outer corner, or the inner clear width. So it is asked of the same
 * function that prints it rather than measured again here — the two agreeing is
 * the whole requirement, and one computation cannot disagree with itself.
 */
export const wallLength = (
  doc: DrawingDocument,
  wall: WallEntity,
  view: MeasureView,
): number => {
  const labelled = labelledWallLength(
    doc,
    { kind: 'plan', levelId: view.levelId },
    wall,
    view.mode,
  );
  if (labelled !== null) return labelled;
  const { a, b } = wall.getBaseline();
  return distance(a, b);
};

/** centreline length — what the geometry commands actually take */
const baselineLength = (wall: WallEntity): number => {
  const { a, b } = wall.getBaseline();
  return distance(a, b);
};

/**
 * The shared value of a property across a selection, or null when they
 * disagree. Generic because openings prefill their dialog the same way — the
 * rule is about the selection, not about walls.
 */
export function commonValue<T>(
  items: readonly T[],
  of: (item: T) => number,
): number | null {
  if (items.length === 0) return null;
  const first = of(items[0]);
  return items.every((item) => Math.abs(of(item) - first) < 1e-6)
    ? first
    : null;
}

/** prefill text for a field: the shared value, or blank when they disagree */
export const prefill = (value: number | null): string =>
  value === null ? '' : formatLengthValue(value);

/** meters, or null when the text is unparseable or not a usable size */
function meters(text: string): number | null {
  if (text.trim() === '') return null;
  const value = parseLength(text, lengthUnit.get());
  return value !== null && value > 1e-3 ? value : null;
}

/**
 * The centreline length that lands the wall on `wantedExtent`, or null when
 * that is not a wall at all.
 *
 * The dialog talks in drawn extents and the geometry commands take centrelines,
 * and the difference between them is the corner miters. Rather than trying to
 * predict what the miters become after the edit, the DELTA is carried across
 * unchanged: grow the label by 0.85 and the centreline grows by 0.85, which is
 * the same thing for any join that survives the edit.
 *
 * That trick is what makes inside mode cost nothing here. The delta is measured
 * against whatever the label said, so asking for a clear width of 6.70 where it
 * read 5.70 adds a metre to the centreline exactly as asking for an overall
 * 7.30 where it read 6.30 does — the mode only has to be the same on both sides
 * of the subtraction.
 */
function targetBaseline(
  doc: DrawingDocument,
  wall: WallEntity,
  view: MeasureView,
  wantedExtent: number,
): number | null {
  const target =
    baselineLength(wall) + (wantedExtent - wallLength(doc, wall, view));
  return target > 1e-3 ? target : null;
}

/**
 * Apply the edited dimensions to the selected walls. Returns the fields that
 * were filled in but unusable — non-empty means nothing was applied, so a bad
 * height cannot land a good length on its own and leave the dialog half done.
 *
 * One history group: a length + height edit is one undo, not two.
 */
export function applyMeasurements(
  session: EditorSession,
  walls: readonly WallEntity[],
  edits: MeasurementEdits,
  view: MeasureView,
  spread: ResizeSpread = 'push',
): MeasurementField[] {
  // length belongs to one baseline; there is no sensible way to give six
  // walls the same length at once, so it is a single-wall edit only
  const single = walls.length === 1 ? walls[0] : null;
  const wanted: MeasurementEdits = {
    ...edits,
    length: single ? edits.length : '',
  };

  const fields: MeasurementField[] = ['length', 'height', 'thickness'];
  const invalid = fields.filter(
    (field) => wanted[field].trim() !== '' && meters(wanted[field]) === null,
  );

  const height = meters(wanted.height);
  const thickness = meters(wanted.thickness);
  const length = meters(wanted.length);

  // resolved before anything is dispatched: a thickness edit changes the
  // miters, so the extent this length was measured against is the one the
  // user was looking at
  const baseline =
    single && length !== null
      ? targetBaseline(session.doc, single, view, length)
      : null;
  // a length that would leave nothing but corner miters is not a wall
  if (single && length !== null && baseline === null) invalid.push('length');
  // ...nor is one that only fits by shortening a neighbour out of existence,
  // which absorbing can do. Asked BEFORE anything is dispatched, so the dialog
  // says it does not fit instead of the plan quietly half-applying it.
  else if (
    single &&
    baseline !== null &&
    !planWallResize(session.doc, single.id, baseline, spread)
  ) {
    invalid.push('length');
  }
  if (invalid.length > 0) return invalid;

  if (height === null && thickness === null && baseline === null) return [];

  session.history.beginGroup();
  try {
    if (height !== null || thickness !== null) {
      session.dispatch('WALL.SETPROPS', {
        ids: walls.map((wall) => wall.id),
        ...(height !== null ? { height } : {}),
        ...(thickness !== null ? { thickness } : {}),
      });
    }
    // Length is a geometry edit, not a property. resizeWallLength grows the
    // wall about its own midpoint and pushes the walls joined at each end out
    // with it, so the corners stay welded and the facing wall — which rides on
    // those cross walls — takes the SAME delta. Nothing here knows which wall
    // is "the opposite one": the join graph decides.
    if (single && baseline !== null) {
      resizeWallLength(
        (name, params) => session.dispatch(name, params),
        session.doc,
        single.id,
        baseline,
        spread,
      );
    }
  } finally {
    session.history.endGroup();
  }
  return [];
}
