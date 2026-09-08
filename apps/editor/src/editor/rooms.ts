import type { DrawingDocument, EntityId, Point } from '@acip/editor-core';
import {
  JOIN_TOLERANCE,
  WallEntity,
  distance,
  isEntityInteractive,
} from '@acip/editor-core';

const TOL = 1e-3;

/** dispatch signature both a session and a tool context satisfy */
export type Dispatch = (name: string, params: unknown) => unknown;

/** an axis-aligned rectangular room recognized from 4 selected walls */
export interface RectRoom {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** each wall with the corner index (0..3) its two endpoints sit on */
  walls: { id: EntityId; aCorner: number; bCorner: number }[];
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;
const samePt = (p: Point, q: Point): boolean =>
  near(p.x, q.x) && near(p.y, q.y);

/** corners bottom-left, bottom-right, top-right, top-left (indices 0..3) */
function corners(
  minX: number,
  minY: number,
  maxX: number,
  maxY: number,
): Point[] {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

export function rectRoomCorners(room: RectRoom): Point[] {
  return corners(room.minX, room.minY, room.maxX, room.maxY);
}

/**
 * Is this selection a clean axis-aligned rectangular room? Four walls, each
 * horizontal or vertical, whose endpoints are exactly the four bbox corners
 * (each shared by two walls). This is what presets and "Add a room" produce,
 * and the shape the numeric editor / drag handles can safely resize.
 */
export function detectRectRoom(
  doc: DrawingDocument,
  ids: readonly EntityId[],
): RectRoom | null {
  if (ids.length !== 4) return null;
  const parts: { id: EntityId; a: Point; b: Point }[] = [];
  for (const id of ids) {
    const e = doc.get(id);
    if (!(e instanceof WallEntity)) return null;
    const bl = e.getBaseline();
    if (!(near(bl.a.x, bl.b.x) || near(bl.a.y, bl.b.y))) return null; // axis-aligned
    parts.push({ id, a: bl.a, b: bl.b });
  }
  const pts = parts.flatMap((p) => [p.a, p.b]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (near(maxX, minX) || near(maxY, minY)) return null;
  const cs = corners(minX, minY, maxX, maxY);
  for (const c of cs) {
    if (pts.filter((p) => samePt(p, c)).length !== 2) return null;
  }
  const walls = parts.map((part) => {
    const aCorner = cs.findIndex((c) => samePt(c, part.a));
    const bCorner = cs.findIndex((c) => samePt(c, part.b));
    return { id: part.id, aCorner, bCorner };
  });
  if (walls.some((w) => w.aCorner < 0 || w.bCorner < 0)) return null;
  return { minX, minY, maxX, maxY, walls };
}

/**
 * Set the room to an explicit new rectangle, moving every wall's shared corner
 * endpoints there in ONE undo step (GRIP.MOVEMANY). Hosted openings ride along
 * at their fraction.
 */
export function resizeRectRoomTo(
  dispatch: Dispatch,
  room: RectRoom,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): void {
  const next = corners(rect.minX, rect.minY, rect.maxX, rect.maxY);
  const moves: { id: EntityId; index: number; to: Point }[] = [];
  for (const w of room.walls) {
    moves.push({ id: w.id, index: 0, to: next[w.aCorner] });
    moves.push({ id: w.id, index: 1, to: next[w.bCorner] });
  }
  dispatch('GRIP.MOVEMANY', { moves });
}

/**
 * What a resize does to the rest of the plan.
 *
 * `push` — everything beyond the growing corner travels with it. A room
 * further along keeps every length and every angle it had; the building gets
 * bigger.
 *
 * `absorb` — only the corner moves. Whatever is immediately beyond it gives up
 * the difference by getting shorter, and the far side of the plan stays where
 * it is; the footprint is unchanged.
 *
 * `alone` — nothing else moves at all. The junction at the growing end simply
 * comes apart, which is the honest result of lengthening one wall of a room
 * and telling the others to stay put. It is the only one of the three that
 * leaves the drawing open, and it is chosen deliberately: a plan is often
 * corrected one wall at a time, and having the rest of the room chase every
 * typed number is worse than a corner to close afterwards.
 *
 * None of them ever rotates a wall it did not have to, which is the point.
 */
export type ResizeSpread = 'push' | 'absorb' | 'alone';

/** which end of a wall a resize holds still */
export interface WallResizePlan {
  /** grip index (0 = baseline 'a', 1 = 'b') that stays put, or null when both move */
  readonly anchorIndex: 0 | 1 | null;
  readonly moves: { id: EntityId; index: number; to: Point }[];
}

/**
 * Which grip index sits on the RIGHT of the wall as drawn on the plan: the end
 * further along +x, and for a vertical wall the one further along +y (its top).
 * Only used to break the tie when BOTH ends are joined — the resize side is
 * otherwise decided by connectivity, not by where a wall happens to point.
 */
function rightGrip(a: Point, b: Point): 0 | 1 {
  if (Math.abs(b.x - a.x) > TOL) return b.x > a.x ? 1 : 0;
  return b.y > a.y ? 1 : 0;
}

/**
 * Work out how to set a wall to `newLength`. Connectivity comes from the
 * wall-join topology itself (`getJoinsAt`) — the same derived discovery that
 * decides whether a corner miters — never from "is there a wall roughly over
 * there".
 *
 * Which end holds still is decided by what is joined to it:
 *
 * - one end joined   → anchor it, stretch from the free end;
 * - both ends joined → anchor the left end, stretch from the right;
 * - neither joined   → grow symmetrically about the midpoint.
 *
 * The anchor side is never touched at all. At the MOVING end, each wall
 * sharing that corner is carried along **rigidly** — translated, so it keeps
 * its own length and bearing exactly — and whatever is welded to its far end
 * stretches to stay welded. In a room that means the facing wall grows by the
 * same delta while the two walls across the room keep their size, and the
 * corners never come apart.
 *
 * A tee is deliberately not carried: our end merely rests on that wall's body,
 * and a continuous wall should not jump because something slid along it.
 */
export function planWallResize(
  doc: DrawingDocument,
  wallId: EntityId,
  newLength: number,
  spread: ResizeSpread = 'push',
): WallResizePlan | null {
  const wall = doc.get(wallId);
  if (!(wall instanceof WallEntity) || newLength <= 0) return null;
  const { a, b } = wall.getBaseline();
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < TOL) return null;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;

  const joins = {
    start: wall.getJoinsAt('start'),
    end: wall.getJoinsAt('end'),
  };

  let anchorIndex: 0 | 1 | null;
  if (joins.start.length > 0 && joins.end.length > 0) {
    anchorIndex = rightGrip(a, b) === 1 ? 0 : 1;
  } else if (joins.start.length > 0) anchorIndex = 0;
  else if (joins.end.length > 0) anchorIndex = 1;
  else anchorIndex = null;

  if (anchorIndex === null) {
    // free-standing: nothing joined to carry, and centring keeps the wall
    // where it sits on the plan
    const half = (newLength - len) / 2;
    return {
      anchorIndex: null,
      moves: [
        {
          id: wallId,
          index: 0,
          to: { x: a.x - ux * half, y: a.y - uy * half },
        },
        {
          id: wallId,
          index: 1,
          to: { x: b.x + ux * half, y: b.y + uy * half },
        },
      ],
    };
  }

  const sign = anchorIndex === 0 ? 1 : -1;
  const grow = newLength - len;
  // the direction the wall grows in: anchor -> moving end
  const out = { x: ux * sign, y: uy * sign };
  const delta = { x: out.x * grow, y: out.y * grow };
  const moved = anchorIndex === 0 ? b : a;

  /*
   * How far a point sits along the growth direction, measured from the corner
   * that is moving. Negative is behind it (toward the anchor), zero is ON it,
   * positive is beyond it.
   *
   * This single number is what decides the whole propagation, and it is a
   * property of the DRAWING. What it replaced counted hops through the join
   * graph — carry the neighbour rigidly, stretch whatever is one step past it
   * — which is a property of the traversal instead, and tore any room that
   * straddled the boundary: a second room had its near wall rigidly carried
   * and its far wall stretched, so it came out sheared, one wall rotated off
   * square and another two thirds shorter.
   */
  const along = (p: Point) => (p.x - moved.x) * out.x + (p.y - moved.y) * out.y;

  if (spread === 'alone') {
    // one grip, and nothing else in the drawing is consulted — not even the
    // walls welded to this one. Deliberately BEFORE the cluster is gathered,
    // so "leave the others alone" cannot become "leave the others alone,
    // mostly".
    return {
      anchorIndex,
      moves: [
        {
          id: wallId,
          index: anchorIndex === 0 ? 1 : 0,
          to: { x: moved.x + delta.x, y: moved.y + delta.y },
        },
      ],
    };
  }

  const carries =
    spread === 'push'
      ? // everything from the moving corner outward travels together, so a
        // room further along keeps every length and every angle it had and is
        // simply further along
        (p: Point) => along(p) > -TOL
      : // only the corner itself moves; whatever is beyond absorbs the change
        // by getting shorter, and the far side of the plan stays put
        (p: Point) => Math.abs(along(p)) <= TOL;

  const moves = new Map<string, { id: EntityId; index: number; to: Point }>();
  for (const member of joinedCluster(doc, wall)) {
    // joined to this structure, but not ours to move: a lock is not undone by
    // sharing a corner with something that grew
    if (!isEntityInteractive(doc, member)) continue;
    for (const grip of member.getGrips()) {
      if (!carries(grip.point)) continue;
      moves.set(`${member.id}:${grip.index}`, {
        id: member.id,
        index: grip.index,
        to: { x: grip.point.x + delta.x, y: grip.point.y + delta.y },
      });
    }
  }

  // the anchor is the one thing that must never move. `along` puts it at -len
  // so it is already excluded, but a zero-length stub welded to it would sit
  // at 0 and drag it along.
  moves.delete(`${wallId}:${anchorIndex}`);

  // Absorbing has a floor: a neighbour can only give up so much before it is
  // not a wall any more. Refused rather than clamped, because silently
  // applying a different number than the one that was typed is worse than
  // saying it does not fit.
  return collapses(doc, moves)
    ? null
    : { anchorIndex, moves: [...moves.values()] };
}

/**
 * Every wall welded into the same structure as `from`, corner joins and tees
 * alike.
 *
 * The bound that matters: a resize must not reach a wall it is not actually
 * connected to. Without it, "everything beyond the corner moves" would also
 * pick up the separate building parked further along the same axis, because
 * being further along is all that predicate tests.
 */
function joinedCluster(doc: DrawingDocument, from: WallEntity): WallEntity[] {
  const seen = new Set<EntityId>([from.id]);
  const cluster = [from];
  const queue = [from];
  while (queue.length > 0) {
    const wall = queue.pop() as WallEntity;
    for (const side of ['start', 'end'] as const) {
      for (const join of wall.getJoinsAt(side)) {
        if (seen.has(join.wall.id)) continue;
        seen.add(join.wall.id);
        cluster.push(join.wall);
        queue.push(join.wall);
      }
    }
  }
  return cluster;
}

/** would this plan shorten some wall out of existence? */
function collapses(
  doc: DrawingDocument,
  moves: ReadonlyMap<string, { id: EntityId; index: number; to: Point }>,
): boolean {
  const touched = new Set<EntityId>();
  for (const move of moves.values()) touched.add(move.id);
  for (const id of touched) {
    const wall = doc.get(id);
    if (!(wall instanceof WallEntity)) continue;
    const ends = wall.getGrips().map((grip) => {
      const move = moves.get(`${id}:${grip.index}`);
      return move ? move.to : grip.point;
    });
    if (ends.length === 2 && distance(ends[0], ends[1]) <= TOL) return true;
  }
  return false;
}

/**
 * Set a wall to an explicit length, holding whichever end is joined to another
 * wall. One undo step (GRIP.MOVEMANY), and never more than this wall's own
 * two grips — walls joined to it keep their geometry exactly.
 */
export function resizeWallLength(
  dispatch: Dispatch,
  doc: DrawingDocument,
  wallId: EntityId,
  newLength: number,
  spread: ResizeSpread = 'push',
): void {
  const plan = planWallResize(doc, wallId, newLength, spread);
  if (plan) dispatch('GRIP.MOVEMANY', { moves: plan.moves });
}

/**
 * The wall's bearing, in degrees, measured from its start to its end.
 *
 * Always a → b, whichever end the drawing happens to hold still. The
 * alternative — reporting the bearing from the anchored end — makes the same
 * wall read 23° or 203° depending on a join it did not ask for, and a surveyed
 * plan quotes one of those, not either.
 */
export function wallBearing(wall: WallEntity): number {
  const { a, b } = wall.getBaseline();
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/**
 * Turn a wall to an exact bearing, holding whichever end is joined.
 *
 * The companion to setting a length, and the other half of what it takes to
 * reproduce a surveyed plan: a wall is a length and a direction, and dragging
 * on a phone can land neither. Together they place the far end exactly.
 *
 * The anchor is chosen the way a resize chooses it — by what is joined, not by
 * which way the wall happens to point — so setting a length and then a bearing
 * pivots about the same corner both times, and the wall does not walk across
 * the plan between two edits that were meant to be one.
 *
 * `spread` carries the same meaning it does for a resize: `alone` turns this
 * wall and nothing else, anything else takes the corner's welded neighbours
 * with it so a room stays a room.
 */
export function planWallRotate(
  doc: DrawingDocument,
  wallId: EntityId,
  degrees: number,
  spread: ResizeSpread = 'push',
): { moves: { id: EntityId; index: number; to: Point }[] } | null {
  const wall = doc.get(wallId);
  if (!(wall instanceof WallEntity) || !Number.isFinite(degrees)) return null;
  const { a, b } = wall.getBaseline();
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < TOL) return null;

  const rad = (degrees * Math.PI) / 180;
  const dir = { x: Math.cos(rad), y: Math.sin(rad) };

  const joins = {
    start: wall.getJoinsAt('start'),
    end: wall.getJoinsAt('end'),
  };
  let anchorIndex: 0 | 1 | null;
  if (joins.start.length > 0 && joins.end.length > 0) anchorIndex = 0;
  else if (joins.start.length > 0) anchorIndex = 0;
  else if (joins.end.length > 0) anchorIndex = 1;
  else anchorIndex = null;

  if (anchorIndex === null) {
    // nothing joined to hold, so it turns about its own middle and stays put
    const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const half = { x: (dir.x * len) / 2, y: (dir.y * len) / 2 };
    return {
      moves: [
        { id: wallId, index: 0, to: { x: mid.x - half.x, y: mid.y - half.y } },
        { id: wallId, index: 1, to: { x: mid.x + half.x, y: mid.y + half.y } },
      ],
    };
  }

  // the anchor stays; the free end swings to where the bearing puts it. Solved
  // from a → b either way, so the number typed is the number that comes back.
  const movingIndex = anchorIndex === 0 ? 1 : 0;
  const moved = anchorIndex === 0 ? b : a;
  const to =
    anchorIndex === 0
      ? { x: a.x + dir.x * len, y: a.y + dir.y * len }
      : { x: b.x - dir.x * len, y: b.y - dir.y * len };

  const moves = [{ id: wallId, index: movingIndex, to }];
  if (spread === 'alone') return { moves };

  // the corner is welded, so everything on it swings together — the same rule
  // dragging that corner by hand already follows
  for (const member of joinedCluster(doc, wall)) {
    if (member.id === wallId || !isEntityInteractive(doc, member)) continue;
    for (const grip of member.getGrips()) {
      if (grip.index > 1) continue; // an apex or a centre is not a corner
      if (distance(grip.point, moved) <= JOIN_TOLERANCE) {
        moves.push({ id: member.id, index: grip.index, to });
      }
    }
  }
  return { moves };
}

/** turn a wall to an exact bearing; one undo step */
export function rotateWallTo(
  dispatch: Dispatch,
  doc: DrawingDocument,
  wallId: EntityId,
  degrees: number,
  spread: ResizeSpread = 'push',
): void {
  const plan = planWallRotate(doc, wallId, degrees, spread);
  if (plan) dispatch('GRIP.MOVEMANY', { moves: plan.moves });
}

export interface StickyWallMovePlan {
  /** grip moves to dispatch (GRIP.MOVEMANY), one undo step */
  moves: { id: EntityId; index: number; to: Point }[];
  /** preview segments for attached walls stretching (fixed end → moved corner) */
  ghosts: { a: Point; b: Point }[];
}

/**
 * Plan a whole-wall move that carries its joins: the selected walls translate
 * by `delta`, and any wall welded to one of their corners has that endpoint
 * follow (stretching, its far end fixed) so junctions stay intact. Returns
 * null unless every selected entity is a wall — other selections fall back to
 * a plain translate.
 *
 * Only walls the user may actually edit are carried. A wall welded to a locked
 * one does not drag it along: sharing a corner is not permission, and the
 * junction simply comes apart where the lock is — which is the honest outcome
 * of moving one of two walls that were joined.
 */
export function planStickyWallMove(
  doc: DrawingDocument,
  ids: readonly EntityId[],
  delta: Point,
): StickyWallMovePlan | null {
  if (ids.length === 0) return null;
  const idSet = new Set(ids);
  const moves: { id: EntityId; index: number; to: Point }[] = [];
  const movingCorners: Point[] = [];
  for (const id of ids) {
    const e = doc.get(id);
    if (!(e instanceof WallEntity)) return null; // sticky move is wall-only
    const { a, b } = e.getBaseline();
    moves.push({ id, index: 0, to: { x: a.x + delta.x, y: a.y + delta.y } });
    moves.push({ id, index: 1, to: { x: b.x + delta.x, y: b.y + delta.y } });
    movingCorners.push(a, b);
  }
  const ghosts: { a: Point; b: Point }[] = [];
  const onCorner = (p: Point) => movingCorners.some((c) => samePt(c, p));
  for (const e of doc.all()) {
    if (!(e instanceof WallEntity) || idSet.has(e.id)) continue;
    if (!isEntityInteractive(doc, e)) continue;
    const { a, b } = e.getBaseline();
    if (onCorner(a)) {
      const to = { x: a.x + delta.x, y: a.y + delta.y };
      moves.push({ id: e.id, index: 0, to });
      ghosts.push({ a: b, b: to });
    }
    if (onCorner(b)) {
      const to = { x: b.x + delta.x, y: b.y + delta.y };
      moves.push({ id: e.id, index: 1, to });
      ghosts.push({ a, b: to });
    }
  }
  return { moves, ghosts };
}

/** resize to new outer dimensions, anchored at the bottom-left corner */
export function resizeRectRoom(
  dispatch: Dispatch,
  room: RectRoom,
  newWidth: number,
  newHeight: number,
): void {
  resizeRectRoomTo(dispatch, room, {
    minX: room.minX,
    minY: room.minY,
    maxX: room.minX + newWidth,
    maxY: room.minY + newHeight,
  });
}
