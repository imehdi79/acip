import type { EditorSession } from '@acip/editor-core';
import { WallEntity, distance } from '@acip/editor-core';
import { formatLengthValue, lengthUnit, parseLength } from '@/editor/units';
import { resizeWallLength } from '@/editor/rooms';
import { wallExtent } from '@/editor/viewport/wall-dimensions';

export type MeasurementField = 'length' | 'height' | 'thickness';

/** what the three inputs hold; blank means "leave this alone" */
export type MeasurementEdits = Record<MeasurementField, string>;

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
 * The length this wall is LABELLED with on the plan — its overall drawn
 * extent, outer corner to outer corner, not its centreline. The dialog has to
 * agree with the number the user is reading off the drawing, or "7.15 → 8.00"
 * silently means something else.
 */
export const wallLength = (wall: WallEntity): number => {
  const extent = wallExtent(wall);
  if (extent) return extent.length;
  const { a, b } = wall.getBaseline();
  return distance(a, b);
};

/** centreline length — what the geometry commands actually take */
const baselineLength = (wall: WallEntity): number => {
  const { a, b } = wall.getBaseline();
  return distance(a, b);
};

/** the shared value of a wall property, or null when the walls disagree */
export function commonValue(
  walls: readonly WallEntity[],
  of: (wall: WallEntity) => number,
): number | null {
  if (walls.length === 0) return null;
  const first = of(walls[0]);
  return walls.every((wall) => Math.abs(of(wall) - first) < 1e-6)
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
 */
function targetBaseline(wall: WallEntity, wantedExtent: number): number | null {
  const target = baselineLength(wall) + (wantedExtent - wallLength(wall));
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
    single && length !== null ? targetBaseline(single, length) : null;
  // a length that would leave nothing but corner miters is not a wall
  if (single && length !== null && baseline === null) invalid.push('length');
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
      );
    }
  } finally {
    session.history.endGroup();
  }
  return [];
}
