import type {
  DrawingDocument,
  EditorSession,
  LevelId,
  Point,
} from '@acip/editor-core';
import { WallEntity, distance } from '@acip/editor-core';
import { formatLengthValue, lengthUnit, parseLength } from '@/editor/units';
import {
  moveWallStartTo,
  planWallResize,
  resizeWallLength,
  rotateWallTo,
  wallBearing,
} from '@/editor/rooms';
import type { ResizeSpread } from '@/editor/rooms';
import { labelledWallLength } from '@/editor/viewport/wall-dimensions';
import type { MeasureMode, ResizeReach } from '@/editor/ui-state';

/** the three plain sizes, which are the only things with a text box each */
export type SizeField = 'length' | 'height' | 'thickness';

/** everything the dialog can report as unusable, jogs included */
export type MeasurementField =
  | SizeField
  | 'jogStart'
  | 'jogEnd'
  | 'sweep'
  | 'angle'
  | 'startX'
  | 'startY';

/** where the wall's start corner sits, as the dialog holds it */
export interface StartEdit {
  readonly x: string;
  readonly y: string;
}

/** which corner of the wall a jog belongs to */
export type JogSide = 'start' | 'end';

/** one corner's step, as the dialog holds it */
export interface JogEdit {
  readonly on: boolean;
  /** the step size as typed; a negative steps the other way */
  readonly size: string;
}

export type JogEdits = Record<JogSide, JogEdit>;

/** what the three size inputs hold; blank means "leave this alone" */
export type MeasurementEdits = Record<SizeField, string>;

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

/**
 * The two controls that decide what a typed length does to the rest of the
 * plan, resolved into the one answer the geometry takes.
 *
 * SETTINGS is the outer question: does anything else move at all? Only when it
 * does does the footer's move-separately toggle get to answer the inner one:
 * are the walls beyond pushed along intact, or made to absorb the change and
 * stay put.
 *
 * A function rather than a ternary at the call site because the ORDER of the
 * two matters and is not obvious — read the other way round, "move separately"
 * would silently override a setting the user went into a sheet to choose.
 */
export function resizeSpreadFor(
  reach: ResizeReach,
  detachedMove: boolean,
): ResizeSpread {
  if (reach === 'alone') return 'alone';
  return detachedMove ? 'absorb' : 'push';
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

/**
 * Where the wall's start corner sits, in the active unit.
 *
 * The last piece of placing a wall by number. Length and angle put the far end
 * exactly once the near one is right — this is what makes the near one right,
 * and without it the first wall of a traced plan still had to be dragged into
 * place by hand.
 */
export function startPrefill(wall: WallEntity): StartEdit {
  const { a } = wall.getBaseline();
  return { x: formatLengthValue(a.x), y: formatLengthValue(a.y) };
}

/**
 * A typed coordinate in meters, or null when the text cannot be one.
 *
 * Unlike every length here it may be NEGATIVE and it may be zero: a coordinate
 * is a position on the plan, not a size, and the origin is a perfectly good
 * place for a corner to be.
 */
function coordinate(text: string): number | null {
  if (text.trim() === '') return null;
  return parseLength(text, lengthUnit.get());
}

/**
 * The wall's bearing as the dialog shows it: degrees, always start to end.
 *
 * Two decimals, because a surveyed plan is drawn to the centimetre and a wall
 * of six metres swings by more than a centimetre for a hundredth of a degree.
 */
export function anglePrefill(wall: WallEntity): string {
  return wallBearing(wall).toFixed(2);
}

/** a typed bearing in degrees, or null when the text cannot be one */
function bearing(text: string): number | null {
  if (text.trim() === '') return null;
  const deg = Number(text.trim());
  return Number.isFinite(deg) ? ((deg % 360) + 360) % 360 : null;
}

/**
 * The wall's curvature as the dialog shows it: degrees, blank when straight.
 *
 * DEGREES, not radians, and not the radius. Radians are the storage unit and
 * nobody types them; the radius of a gentle curve is a number in the hundreds
 * that changes wildly for a small change in shape. How far the wall turns is
 * the thing a person can picture, and it is what was asked for.
 */
export function sweepPrefill(wall: WallEntity): string {
  const sweep = wall.getSweep();
  return sweep === 0 ? '' : ((sweep * 180) / Math.PI).toFixed(1);
}

/**
 * A typed turn in radians, or null when the text cannot be one.
 *
 * Signed, so a negative bows the wall the other way. Blank means "leave the
 * curvature alone" and is not an instruction to straighten — the footer button
 * is how a wall is straightened, and a blank box quietly undoing a curve would
 * be a trap.
 */
function sweepRadians(text: string): number | null {
  if (text.trim() === '') return null;
  const degrees = Number(text.trim());
  if (!Number.isFinite(degrees)) return null;
  // a full turn has no chord left to draw between, and 0 is the footer's job
  if (Math.abs(degrees) < 1e-6 || Math.abs(degrees) >= 360) return null;
  return (degrees * Math.PI) / 180;
}

/**
 * The two corners of a wall as the dialog shows them: on when the wall
 * already steps there, with the step it steps by.
 */
export function jogPrefill(wall: WallEntity): JogEdits {
  const one = (side: JogSide): JogEdit => {
    const jog = wall.getJog(side);
    return { on: jog !== 0, size: jog === 0 ? '' : formatLengthValue(jog) };
  };
  return { start: one('start'), end: one('end') };
}

/**
 * A jog in meters, or null when the text cannot be one.
 *
 * Signed, unlike every other field here, because a corner can step either way
 * and there is no third control to say which. Zero is rejected the same as
 * blank: a step of nothing is the switch being off, and the switch already
 * says that.
 */
function jogMeters(text: string): number | null {
  if (text.trim() === '') return null;
  const size = parseLength(text.replace('-', ''), lengthUnit.get());
  if (size === null || size <= 1e-3) return null;
  return text.trim().startsWith('-') ? -size : size;
}

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
  jogs?: JogEdits,
  sweep?: string,
  angle?: string,
  start?: StartEdit,
): MeasurementField[] {
  // length belongs to one baseline; there is no sensible way to give six
  // walls the same length at once, so it is a single-wall edit only
  const single = walls.length === 1 ? walls[0] : null;
  const wanted: MeasurementEdits = {
    ...edits,
    length: single ? edits.length : '',
  };

  const fields = ['length', 'height', 'thickness'] as const;
  const invalid: MeasurementField[] = fields.filter(
    (field) => wanted[field].trim() !== '' && meters(wanted[field]) === null,
  );

  /*
   * A jog is per-corner, so it is a single-wall edit for the same reason
   * Length is: there is no one corner shared by six walls.
   *
   * A switch that is ON with nothing usable in its box is the error worth
   * catching. Switching one OFF is a real instruction — remove the step —
   * so it needs no size at all and is written as a zero.
   */
  /*
   * Curvature is a single-wall edit for the same reason Length is: it is a
   * shape, and there is no one shape six walls share.
   *
   * Blank leaves it alone. Only text that cannot be an angle is an error —
   * which is what stops a typo silently straightening a curved wall.
   */
  /*
   * A bearing is a single-wall edit for the same reason a length is: six walls
   * pointing one way is a different operation, and not one anybody asked for.
   *
   * Blank leaves it alone. Unchanged is left alone too, so re-applying a
   * dialog that was only opened to fix a height does not quietly re-seat a
   * wall on the rounded version of its own angle.
   */
  /*
   * A position is a single-wall edit, and both boxes have to be readable
   * before either is used: moving a wall to a good x and a broken y would put
   * it somewhere the user never asked for, on an axis they were not editing.
   */
  let wantedStart: Point | null = null;
  if (single && start && (start.x.trim() !== '' || start.y.trim() !== '')) {
    const here = single.getBaseline().a;
    const x = start.x.trim() === '' ? here.x : coordinate(start.x);
    const y = start.y.trim() === '' ? here.y : coordinate(start.y);
    if (x === null) invalid.push('startX');
    if (y === null) invalid.push('startY');
    if (x !== null && y !== null && (x !== here.x || y !== here.y)) {
      wantedStart = { x, y };
    }
  }

  let wantedAngle: number | null = null;
  if (single && angle !== undefined && angle.trim() !== '') {
    const deg = bearing(angle);
    if (deg === null) invalid.push('angle');
    else if (Math.abs(deg - wallBearing(single)) > 1e-6) wantedAngle = deg;
  }

  let wantedSweep: number | null = null;
  if (single && sweep !== undefined && sweep.trim() !== '') {
    const radians = sweepRadians(sweep);
    if (radians === null) invalid.push('sweep');
    else if (Math.abs(radians - single.getSweep()) > 1e-9) {
      wantedSweep = radians;
    }
  }

  const wantedJogs: { side: JogSide; offset: number }[] = [];
  if (single && jogs) {
    for (const side of ['start', 'end'] as const) {
      const edit = jogs[side];
      const offset = jogMeters(edit.size);
      if (!edit.on) {
        if (single.getJog(side) !== 0) wantedJogs.push({ side, offset: 0 });
        continue;
      }
      if (offset === null) {
        invalid.push(side === 'start' ? 'jogStart' : 'jogEnd');
        continue;
      }
      if (offset !== single.getJog(side)) wantedJogs.push({ side, offset });
    }
  }

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

  if (
    height === null &&
    thickness === null &&
    baseline === null &&
    wantedJogs.length === 0 &&
    wantedSweep === null &&
    wantedAngle === null &&
    wantedStart === null
  ) {
    return [];
  }

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
    // After the length, so the wall is the right size before it is aimed —
    // both pivot about the same anchored corner, so the far end lands where
    // the two numbers together say it should.
    if (single && wantedAngle !== null) {
      rotateWallTo(
        (name, params) => session.dispatch(name, params),
        session.doc,
        single.id,
        wantedAngle,
        spread,
      );
    }
    // LAST of the three placements, and the only order that composes: length
    // says how big, angle says which way, and a translation is the one edit
    // that can honour both while putting the corner where it was asked for.
    if (single && wantedStart !== null) {
      moveWallStartTo(
        (name, params) => session.dispatch(name, params),
        session.doc,
        single.id,
        wantedStart,
        spread,
      );
    }
    // before the corners, so a step is measured against the curved wall the
    // user will actually be looking at
    if (single && wantedSweep !== null) {
      session.dispatch('WALL.SETARC', { ids: [single.id], sweep: wantedSweep });
    }
    // last, so a corner steps from wherever the length edit left it
    for (const { side, offset } of wantedJogs) {
      session.dispatch('WALL.SETJOG', {
        ids: [single?.id],
        which: side,
        offset,
      });
    }
  } finally {
    session.history.endGroup();
  }
  return [];
}
