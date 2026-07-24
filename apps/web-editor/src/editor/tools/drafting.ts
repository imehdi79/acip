import { WallEntity, hasGrips } from '@acip/editor-core';
import type { DrawingDocument, Point } from '@acip/editor-core';

/**
 * Drafting aids shared by the drawing and select tools: pull a direction onto a
 * clean angle, and read the live angles at a corner being dragged. Pure
 * geometry — the tools decide when to apply it and the renderer draws the
 * feedback.
 */

const RAD = Math.PI / 180;
const CORNER_TOL = 1e-4; // endpoints closer than this share a corner (JOIN_TOLERANCE)

export interface AngleResult {
  /** the constrained point (moved onto the clean bearing) or the input unchanged */
  point: Point;
  /** true when the bearing was pulled to a special angle */
  locked: boolean;
  /** the bearing used, in degrees (0 = +x, CCW) */
  deg: number;
}

/**
 * Pull the direction from → to onto a clean bearing. `ortho` (Shift) forces 90°
 * steps; otherwise the bearing snaps to the nearest `step`° only when within
 * `tol`°, and is left exactly as drawn past that — so intentional diagonals
 * still draw freely. Distance to the cursor is preserved along the bearing.
 */
export function constrainAngle(
  from: Point,
  to: Point,
  ortho: boolean,
  step = 15,
  tol = 6,
): AngleResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) / RAD; // -180..180
  if (len < 1e-9) return { point: to, locked: false, deg: ang };

  const snapStep = ortho ? 90 : step;
  const nearest = Math.round(ang / snapStep) * snapStep;
  if (ortho || Math.abs(ang - nearest) <= tol) {
    const a = nearest * RAD;
    return {
      point: { x: from.x + len * Math.cos(a), y: from.y + len * Math.sin(a) },
      locked: true,
      deg: ((nearest % 360) + 360) % 360,
    };
  }
  return { point: to, locked: false, deg: ((ang % 360) + 360) % 360 };
}

export interface AngleMark {
  /** corner position (world) */
  at: Point;
  /** arc start bearing (radians, world CCW) */
  from: number;
  /** arc end bearing (radians, world CCW; always > from, the wedge swept) */
  to: number;
  /** the wedge angle in degrees, for the label */
  deg: number;
}

const near = (p: Point, q: Point): boolean =>
  Math.hypot(p.x - q.x, p.y - q.y) <= CORNER_TOL;

/** unit-vector bearings of every wall leaving corner `p`, using live positions */
function bearingsAt(
  doc: DrawingDocument,
  p: Point,
  anchor: Point,
  cursor: Point,
): number[] {
  const move = (q: Point): Point => (near(q, anchor) ? cursor : q);
  const here = near(p, anchor) ? cursor : p;
  const out: number[] = [];
  for (const e of doc.all()) {
    if (!(e instanceof WallEntity)) continue;
    const { a, b } = e.getBaseline();
    const ma = move(a);
    const mb = move(b);
    let other: Point | null = null;
    if (near(ma, here)) other = mb;
    else if (near(mb, here)) other = ma;
    if (!other) continue;
    const dx = other.x - here.x;
    const dy = other.y - here.y;
    if (Math.hypot(dx, dy) < CORNER_TOL) continue;
    out.push(Math.atan2(dy, dx));
  }
  return out;
}

/** wedge marks between consecutive bearings at a corner (skips straight/reflex) */
function marksFromBearings(at: Point, bearings: number[]): AngleMark[] {
  if (bearings.length < 2) return [];
  const sorted = [...bearings].sort((a, b) => a - b);
  const marks: AngleMark[] = [];
  for (let i = 0; i < sorted.length; i++) {
    const from = sorted[i];
    const to = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + Math.PI * 2;
    const deg = ((to - from) / RAD);
    // skip straight-through and the outer reflex wedge of a simple corner
    if (deg < 1 || deg > 179) continue;
    marks.push({ at, from, to, deg });
  }
  return marks;
}

/**
 * Live corner angles while a corner is dragged from `anchor` to `cursor`:
 * the wedges at the dragged corner itself, and at each far end of the walls
 * that follow it (the "attached" corners the user asked to see).
 */
export function cornerAngles(
  doc: DrawingDocument,
  anchor: Point,
  cursor: Point,
): AngleMark[] {
  const marks: AngleMark[] = [];
  const seen = new Set<string>();
  const addCorner = (p: Point): void => {
    const key = `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;
    if (seen.has(key)) return;
    seen.add(key);
    marks.push(...marksFromBearings(p, bearingsAt(doc, p, anchor, cursor)));
  };

  // the dragged corner (now at the cursor)
  addCorner(cursor);
  // the far end of every wall welded to the dragged corner
  for (const e of doc.all()) {
    if (!(e instanceof WallEntity)) continue;
    const { a, b } = e.getBaseline();
    if (near(a, anchor)) addCorner(b);
    else if (near(b, anchor)) addCorner(a);
  }
  return marks;
}

/** a dashed tracking line from an existing corner to the aligned point */
export interface AlignGuide {
  a: Point;
  b: Point;
}

export interface AlignResult {
  point: Point;
  guides: AlignGuide[];
}

/**
 * Object-snap tracking: if the cursor lines up (within `tol` meters) with an
 * existing corner's X or Y, pull that coordinate onto it and return a dashed
 * guide from the corner to the aligned point. Snapping X and Y independently
 * means the cursor can land on the *intersection* of two tracking lines.
 * `exclude` skips a corner (the one being dragged), so it can't track itself.
 */
export function alignGuides(
  doc: DrawingDocument,
  point: Point,
  tol: number,
  exclude?: Point,
): AlignResult {
  let bestX: { at: Point; d: number } | null = null;
  let bestY: { at: Point; d: number } | null = null;
  for (const e of doc.all()) {
    if (!hasGrips(e)) continue;
    for (const g of e.getGrips()) {
      const p = g.point;
      if (exclude && near(p, exclude)) continue;
      const dx = Math.abs(p.x - point.x);
      if (dx <= tol && (!bestX || dx < bestX.d)) bestX = { at: p, d: dx };
      const dy = Math.abs(p.y - point.y);
      if (dy <= tol && (!bestY || dy < bestY.d)) bestY = { at: p, d: dy };
    }
  }
  const out: Point = { x: bestX ? bestX.at.x : point.x, y: bestY ? bestY.at.y : point.y };
  const guides: AlignGuide[] = [];
  if (bestX) guides.push({ a: bestX.at, b: { x: out.x, y: out.y } });
  if (bestY) guides.push({ a: bestY.at, b: { x: out.x, y: out.y } });
  return { point: out, guides };
}
