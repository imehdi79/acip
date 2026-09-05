import type { Point, SnapKind, SnapPoint } from '@acip/editor-core';

/**
 * What counts as a CORNER — a place a wall actually begins, ends or meets
 * another, as opposed to a spot part-way along one.
 *
 * `nearest` is deliberately absent, and it is the whole reason this list
 * exists: the snap engine picks the closest candidate of any kind, and a
 * `nearest` point on an edge is by definition never further away than the
 * corner at the end of that edge. So a corner could only ever win by the
 * finger landing almost exactly on it — which on a phone it does not.
 */
export const CORNER_KINDS: readonly SnapKind[] = [
  'endpoint',
  'node',
  'intersection',
  'center',
];

/** the minimum an engine has to offer for the policy below to work */
export interface Snapper {
  snap(
    cursor: Point,
    tolerance: number,
    filter?: readonly SnapKind[],
  ): SnapPoint | null;
}

export interface MagneticOptions {
  /** px per meter, to turn a screen radius into a world one */
  readonly scale: number;
  /** the ordinary reach, in screen pixels */
  readonly radiusPx: number;
  /** how much further a CORNER pulls from; >= radiusPx or it is not magnetic */
  readonly cornerPullPx: number;
  /** where this drag began, when one is in progress */
  readonly origin?: Point | null;
  /** how close counts as "back where I picked it up" */
  readonly originPullPx: number;
}

/**
 * Where a dragged point actually lands.
 *
 * Three passes, strongest first, because "closest wins" is the wrong rule for
 * a finger. A thumb covers a centimetre and lands within a centimetre of what
 * it meant; the question is not which candidate is nearest but which one the
 * user was reaching for.
 *
 * 1. HOME. Coming back to where the drag started snaps exactly there. Putting
 *    a thing back is a thing people do constantly and the one outcome the
 *    plain rule cannot express: with only proximity, "back where it was" lands
 *    a few millimetres off and quietly moves the wall by that much. It wins
 *    outright, because a user returning to the start is not aiming at whatever
 *    else happens to be nearby.
 *
 * 2. CORNERS, from further away than anything else. A corner is where walls
 *    are actually meant to meet, and it is the target the plain rule can never
 *    pick — an edge's `nearest` point is always at least as close as the
 *    corner ending that edge, so without a wider reach of its own a corner
 *    only wins when the finger is already on it.
 *
 * 3. Anything else, at the ordinary radius.
 *
 * Pure, and over an interface rather than the engine class, so the ladder is
 * checkable without a document.
 */
export function magneticSnap(
  engine: Snapper,
  raw: Point,
  options: MagneticOptions,
): SnapPoint | null {
  const world = (px: number) => px / options.scale;

  const origin = options.origin;
  if (origin) {
    const back = Math.hypot(raw.x - origin.x, raw.y - origin.y);
    if (back <= world(options.originPullPx)) {
      // synthetic, and honestly labelled: it is a node in the sense that
      // matters — a specific point the drag is being held to
      return { kind: 'node', point: origin };
    }
  }

  return (
    engine.snap(raw, world(options.cornerPullPx), CORNER_KINDS) ??
    engine.snap(raw, world(options.radiusPx))
  );
}

/**
 * How wide the net is, which is not one number.
 *
 * GRABBING wants a wide net: the finger has to find the grip, and missing it
 * costs a whole gesture. PLACING wants a narrow one: the thing is already in
 * hand, the finger is now steering it, and a wide net drags it onto every
 * candidate it sails past — which is the "I cannot put it where I want it"
 * complaint, and the reason a drag felt coarser than the tap that started it.
 *
 * So the radius shrinks once a drag is underway. The corner pull does not
 * shrink as far, because corners are still what a drag is usually aiming at.
 */
export const TOUCH_GRAB_PX = 24;
export const TOUCH_DRAG_PX = 12;
export const TOUCH_CORNER_PULL_PX = 28;
export const TOUCH_DRAG_CORNER_PULL_PX = 20;
export const TOUCH_HOME_PULL_PX = 14;

export function touchSnapOptions(
  scale: number,
  dragging: boolean,
  origin: Point | null,
): MagneticOptions {
  return {
    scale,
    radiusPx: dragging ? TOUCH_DRAG_PX : TOUCH_GRAB_PX,
    cornerPullPx: dragging ? TOUCH_DRAG_CORNER_PULL_PX : TOUCH_CORNER_PULL_PX,
    origin: dragging ? origin : null,
    originPullPx: TOUCH_HOME_PULL_PX,
  };
}
