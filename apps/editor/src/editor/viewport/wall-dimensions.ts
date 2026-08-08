import type {
  DrawingDocument,
  EntityId,
  Point,
  ViewDefinition,
} from '@acip/editor-core';
import { WallEntity } from '@acip/editor-core';

/**
 * One wall's automatic dimension, in world space.
 *
 * `a`, `b` and `length` are derived together from the same two points, so the
 * drawn line and the printed number can never disagree.
 */
export interface WallDimension {
  readonly wallId: EntityId;
  /** measurement anchors, on the wall's axis, at its full drawn extent */
  readonly a: Point;
  readonly b: Point;
  /** distance(a, b) — exactly what the label reads */
  readonly length: number;
}

/**
 * Overall extent of a wall measured along its own axis: the wall as drawn,
 * from outer corner to outer corner.
 *
 * Derived by projecting the wall's own outline onto its axis, so the cap
 * mathematics is never re-implemented here — miters, tees and butt ends are
 * whatever core already decided to draw. Consequences worth knowing:
 *
 * - a free-standing wall has butt caps, so its extent equals its centreline
 *   length and thickness changes nothing;
 * - a wall mitered into a corner reaches past its endpoint to the outer
 *   corner, so it measures longer than its centreline by the miter;
 * - a wall teed into another's face may stop SHORT of its endpoint, and the
 *   dimension shortens with it — that is the drawn wall, faithfully.
 *
 * Returns null for a degenerate wall, which has no direction to measure along.
 */
export function wallExtent(wall: WallEntity): WallDimension | null {
  const { a, b } = wall.getBaseline();
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const ux = dx / length;
  const uy = dy / length;

  let min = Infinity;
  let max = -Infinity;
  for (const corner of wall.getOutline()) {
    const s = (corner.x - a.x) * ux + (corner.y - a.y) * uy;
    if (s < min) min = s;
    if (s > max) max = s;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  return {
    wallId: wall.id,
    a: { x: a.x + ux * min, y: a.y + uy * min },
    b: { x: a.x + ux * max, y: a.y + uy * max },
    length: max - min,
  };
}

/** Every wall on the view's level, with its overall extent. */
export function wallDimensions(
  doc: DrawingDocument,
  view: ViewDefinition,
): WallDimension[] {
  // plan-only; the 3D view definition carries no level
  if (view.kind !== 'plan') return [];
  const levelId = view.levelId ?? null;
  const out: WallDimension[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof WallEntity)) continue;
    if ((entity.baseLevelId ?? null) !== levelId) continue;
    const dim = wallExtent(entity);
    if (dim) out.push(dim);
  }
  return out;
}
