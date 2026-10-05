import type {
  DrawingDocument,
  EntityId,
  Geometry,
  Point,
} from '@acip/editor-core';
import {
  WallEntity,
  add,
  distance,
  isEntityInteractive,
  normalize,
  perpendicular,
  scale,
  sub,
} from '@acip/editor-core';

/**
 * Bending a wall from the plan.
 *
 * The sweep, the arc, and what a pulled point means all live in core. What
 * lives here is the answer to "what is on the screen, and what did the finger
 * just grab" — a UI question the geometry has no business holding an opinion
 * about.
 *
 * The handle belongs to the MIDDLE OF THE WALL: the midpoint of a straight
 * one, the apex of a bowed one. It is not a grip. Grips are the two ends — the
 * points junctions weld to, that a sticky corner carries and a resize drags —
 * and putting the bend in among them would hand it to every one of those
 * machineries as a corner they are entitled to move. So it is hit-tested,
 * previewed and committed here instead, and the wall's ends stay the only
 * thing anything else has to know about.
 */

/** dispatch signature both a session and a tool context satisfy */
export type Dispatch = (name: string, params: unknown) => unknown;

/**
 * How far off the wall the button floats, in SCREEN pixels.
 *
 * Off the wall rather than on it, which is the whole reason this number
 * exists: the middle of a wall is also the most natural place to grab it and
 * drag the wall somewhere, and a button sitting there would take that gesture
 * away. Standing it off keeps both — the wall moves from anywhere along its
 * length, and the button is the one thing near it that curves it.
 *
 * In pixels, so the gap is the same gesture at every zoom: at a plan's worth
 * of zoom-out a fixed distance in meters would be under the wall, and on a
 * single room it would be off the screen.
 */
export const BEND_STANDOFF_PX = 26;

/** below this a wall has no middle far enough from its ends to aim at (meters) */
export const MIN_BENDABLE = 0.2;

/** a wall's bend button: where it floats, and the point on the wall it bends */
export interface BendHandle {
  readonly wallId: EntityId;
  /** the button itself — what a tap has to land on */
  readonly point: Point;
  /** the point on the wall it belongs to, which is what the drag moves */
  readonly anchor: Point;
}

/**
 * The buttons to draw for a selection: one per selected wall the user may
 * actually edit.
 *
 * Locked and hidden walls offer none. A handle is an invitation to change
 * something, and offering one on a wall that would refuse the change is worse
 * than showing nothing.
 *
 * `standoff` is in meters — the pixel gap converted by the caller, which is
 * the one place that knows the zoom.
 */
export function bendHandles(
  doc: DrawingDocument,
  selection: readonly EntityId[],
  standoff: number,
): BendHandle[] {
  const handles: BendHandle[] = [];
  for (const id of selection) {
    const wall = doc.get(id);
    if (!(wall instanceof WallEntity)) continue;
    if (!isEntityInteractive(doc, wall)) continue;
    if (wall.getLength() < MIN_BENDABLE) continue;
    const anchor = wall.getBendPoint();
    handles.push({
      wallId: id,
      point: add(anchor, scale(chordNormal(wall), standoff)),
      anchor,
    });
  }
  return handles;
}

/**
 * The side the button stands off on: the +normal of the CHORD, not of the
 * curve.
 *
 * The chord does not move while a wall is being bent, so the button keeps the
 * same side of it for the whole drag and stays under the finger — including
 * through the moment the bow flips over, which taking the side from the curve
 * would turn into a jump across the wall.
 */
function chordNormal(wall: WallEntity): Point {
  const { a, b } = wall.getBaseline();
  return perpendicular(normalize(sub(b, a)));
}

/** the bend button under the point — the nearest one — or null */
export function bendHandleAt(
  doc: DrawingDocument,
  selection: readonly EntityId[],
  at: Point,
  standoff: number,
  tolerance: number,
): BendHandle | null {
  let best: { handle: BendHandle; d: number } | null = null;
  for (const handle of bendHandles(doc, selection, standoff)) {
    const d = distance(handle.point, at);
    if (d <= tolerance && (!best || d < best.d)) best = { handle, d };
  }
  return best?.handle ?? null;
}

/**
 * The wall as it would be if its middle were pulled to `apex`: the sweep to
 * commit, and the centreline to draw while the finger is still down.
 *
 * Both come from the wall itself, so the dashed preview cannot drift from what
 * the commit does — they are one answer, read twice.
 */
export function previewBend(
  doc: DrawingDocument,
  wallId: EntityId,
  apex: Point,
): { sweep: number; ghost: Geometry } | null {
  const wall = doc.get(wallId);
  if (!(wall instanceof WallEntity)) return null;
  const plan = wall.planBend(apex);
  return {
    sweep: plan.sweep,
    ghost: { kind: 'polyline', points: plan.centreline, closed: false },
  };
}

/**
 * Commit the bend.
 *
 * Nothing is dispatched when the sweep has not actually changed, so a TAP on
 * the button — a drag of no distance — costs no undo step and does not make a
 * wall that was already straight look like it was edited.
 */
export function applyBend(
  dispatch: Dispatch,
  doc: DrawingDocument,
  wallId: EntityId,
  sweep: number,
): void {
  const wall = doc.get(wallId);
  if (!(wall instanceof WallEntity)) return;
  if (sweep === wall.getSweep()) return;
  dispatch('WALL.SETARC', { ids: [wallId], sweep });
}
