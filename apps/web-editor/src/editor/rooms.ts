import type { EditorSession, EntityId, Point } from '@acip/editor-core';
import { WallEntity } from '@acip/editor-core';

const TOL = 1e-3;

/** an axis-aligned rectangular room recognized from 4 selected walls */
export interface RectRoom {
  wallIds: EntityId[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

const near = (a: number, b: number): boolean => Math.abs(a - b) <= TOL;
const samePt = (p: Point, q: Point): boolean =>
  near(p.x, q.x) && near(p.y, q.y);

function corners(minX: number, minY: number, maxX: number, maxY: number) {
  return [
    { x: minX, y: minY },
    { x: maxX, y: minY },
    { x: maxX, y: maxY },
    { x: minX, y: maxY },
  ];
}

/**
 * Is this selection a clean axis-aligned rectangular room? Four walls, each
 * horizontal or vertical, whose endpoints are exactly the four bbox corners
 * (each shared by two walls). This is what presets and "Add a room" produce,
 * and the shape the numeric width/length editor can safely resize.
 */
export function detectRectRoom(
  session: EditorSession,
  ids: readonly EntityId[],
): RectRoom | null {
  if (ids.length !== 4) return null;
  const baselines: { a: Point; b: Point }[] = [];
  for (const id of ids) {
    const e = session.doc.get(id);
    if (!(e instanceof WallEntity)) return null;
    const bl = e.getBaseline();
    if (!(near(bl.a.x, bl.b.x) || near(bl.a.y, bl.b.y))) return null; // axis-aligned
    baselines.push(bl);
  }
  const pts = baselines.flatMap((bl) => [bl.a, bl.b]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  if (near(maxX, minX) || near(maxY, minY)) return null;
  const cs = corners(minX, minY, maxX, maxY);
  // every endpoint sits on a corner, and every corner is used by two walls
  for (const p of pts) {
    if (!cs.some((c) => samePt(c, p))) return null;
  }
  for (const c of cs) {
    if (pts.filter((p) => samePt(p, c)).length !== 2) return null;
  }
  return { wallIds: [...ids], minX, minY, maxX, maxY };
}

/**
 * Resize a rectangular room to new outer dimensions, anchored at its
 * bottom-left corner (so it grows up/right). Moves each wall's shared corner
 * endpoints via GRIP.MOVE — hosted openings ride along at their fraction —
 * as a single undo step.
 */
export function resizeRectRoom(
  session: EditorSession,
  room: RectRoom,
  newWidth: number,
  newHeight: number,
): void {
  const { minX, minY, maxX, maxY } = room;
  const oldCorners = corners(minX, minY, maxX, maxY);
  const newCorners = corners(minX, minY, minX + newWidth, minY + newHeight);

  session.history.beginGroup();
  try {
    for (const id of room.wallIds) {
      const w = session.doc.get(id);
      if (!(w instanceof WallEntity)) continue;
      const bl = w.getBaseline();
      moveEndpoint(session, id, 0, bl.a, oldCorners, newCorners);
      moveEndpoint(session, id, 1, bl.b, oldCorners, newCorners);
    }
  } finally {
    session.history.endGroup();
  }
}

function moveEndpoint(
  session: EditorSession,
  id: EntityId,
  index: number,
  p: Point,
  oldCorners: Point[],
  newCorners: Point[],
): void {
  const i = oldCorners.findIndex((c) => samePt(c, p));
  if (i < 0) return;
  const target = newCorners[i];
  if (samePt(target, p)) return;
  session.dispatch('GRIP.MOVE', { id, index, to: target });
}
