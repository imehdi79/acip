import type { DrawingDocument, EntityId, Point } from '@acip/editor-core';
import { WallEntity } from '@acip/editor-core';

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

  const movingIndex = anchorIndex === 0 ? 1 : 0;
  const sign = anchorIndex === 0 ? 1 : -1;
  const grow = newLength - len;
  const delta = { x: ux * sign * grow, y: uy * sign * grow };
  const moved = anchorIndex === 0 ? b : a;

  const moves = new Map<string, { id: EntityId; index: number; to: Point }>();
  const put = (m: { id: EntityId; index: number; to: Point }) =>
    moves.set(`${m.id}:${m.index}`, m);

  // the anchor stays put; the other end slides along the baseline, so the
  // wall keeps its bearing
  put({
    id: wallId,
    index: movingIndex,
    to: { x: moved.x + delta.x, y: moved.y + delta.y },
  });

  // carry the corner partners at that end, rigid so their own size is kept
  for (const join of joins[anchorIndex === 0 ? 'end' : 'start']) {
    if (join.kind !== 'corner') continue;
    const plan = planStickyWallMove(doc, [join.wall.id], delta);
    if (plan) for (const m of plan.moves) put(m);
  }

  // the anchor is the one thing that must never move: a carried wall welded
  // back to it (a triangle, a stub) would otherwise drag it along
  moves.delete(`${wallId}:${anchorIndex}`);

  return { anchorIndex, moves: [...moves.values()] };
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
): void {
  const plan = planWallResize(doc, wallId, newLength);
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
