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

/**
 * Set a single wall to an explicit length by sliding its far endpoint (b)
 * along the wall direction, dragging any wall endpoints welded to that corner
 * with it so joins stay intact. One undo step (GRIP.MOVEMANY). The near
 * endpoint (a) stays put.
 */
export function setWallLength(
  dispatch: Dispatch,
  doc: DrawingDocument,
  wallId: EntityId,
  newLength: number,
): void {
  const wall = doc.get(wallId);
  if (!(wall instanceof WallEntity) || newLength <= 0) return;
  const { a, b } = wall.getBaseline();
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < TOL) return;
  const to: Point = {
    x: a.x + ((b.x - a.x) / len) * newLength,
    y: a.y + ((b.y - a.y) / len) * newLength,
  };
  const moves: { id: EntityId; index: number; to: Point }[] = [];
  for (const other of doc.all()) {
    if (!(other instanceof WallEntity)) continue;
    const bl = other.getBaseline();
    if (samePt(bl.a, b)) moves.push({ id: other.id, index: 0, to });
    if (samePt(bl.b, b)) moves.push({ id: other.id, index: 1, to });
  }
  if (moves.length > 0) dispatch('GRIP.MOVEMANY', { moves });
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
