import { WallEntity, hasGrips, isEntityVisible } from '@acip/editor-core';
import type { DrawingDocument, EntityId, Point } from '@acip/editor-core';

/**
 * Drafting aids shared by the drawing and select tools: pull a direction onto a
 * clean angle, and read the live angles at a corner being dragged. Pure
 * geometry — the tools decide when to apply it and the renderer draws the
 * feedback.
 *
 * Every scan here reads VISIBLE entities only, matching the core snap engine:
 * locked still snaps (drawing onto a plan you may not edit is the point), but
 * hidden never — a guide line to a corner that is not on the screen, or a drag
 * that sticks to one, is the drawing fighting back for no reason the user can
 * see.
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
 * How close a bearing has to be to a SQUARE one to be pulled onto it.
 *
 * Generous, because square is what most walls are and being a couple of
 * degrees off square is almost always a slip rather than a decision.
 */
export const SQUARE_TOL = 6;

/**
 * And how close it has to be to one of the in-between 15° marks.
 *
 * Much tighter, and this is the number that matters on a real survey. At the
 * old ±6° every 15° step captured 12° of the 15 — four fifths of every bearing
 * a finger could ask for was rewritten, so a plan full of 23° and 67° walls
 * simply could not be drawn. There is no Shift key on a phone to escape with
 * either, so the magnet has to leave room rather than offer a way out of it.
 */
export const STEP_TOL = 1.5;

/**
 * Pull the direction from → to onto a clean bearing. `ortho` (Shift) forces 90°
 * steps; otherwise the bearing snaps to the nearest `step`° only when within
 * tolerance, and is left exactly as drawn past that — so intentional diagonals
 * still draw freely. Distance to the cursor is preserved along the bearing.
 *
 * The tolerance is not one number: square bearings hold wide, the 15° marks
 * between them hold narrowly. That asymmetry is the whole point — it keeps the
 * help where walls really are square without rewriting the angles on a plan
 * that is not.
 */
export function constrainAngle(
  from: Point,
  to: Point,
  ortho: boolean,
  step = 15,
  tol?: number,
): AngleResult {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy);
  const ang = Math.atan2(dy, dx) / RAD; // -180..180
  if (len < 1e-9) return { point: to, locked: false, deg: ang };

  const snapStep = ortho ? 90 : step;
  const nearest = Math.round(ang / snapStep) * snapStep;
  // a square bearing keeps the generous pull; everything else gets the tight one
  const square = Math.abs(nearest % 90) < 1e-9;
  const reach = tol ?? (square ? SQUARE_TOL : STEP_TOL);
  if (ortho || Math.abs(ang - nearest) <= reach) {
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
    if (!(e instanceof WallEntity) || !isEntityVisible(doc, e)) continue;
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
    const deg = (to - from) / RAD;
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
    if (!(e instanceof WallEntity) || !isEntityVisible(doc, e)) continue;
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

/** what a drag should actually apply, once the plan has had its say */
export interface DragSnap {
  /** the translation to use — the raw one, pulled onto a node or an alignment */
  delta: Point;
  /** dashed tracking lines to draw */
  guides: AlignGuide[];
  /** the existing node a corner landed exactly on, for the snap marker */
  stuck: { point: Point; entityId: EntityId } | null;
}

/**
 * Snapping for a whole dragged selection, rather than a single cursor.
 *
 * Dragging a room is how rooms get joined, so the thing that must snap is the
 * room's own corners against the corners already drawn — not the fingertip.
 * Two stages, strongest first:
 *
 * 1. **Node stick** — if any dragged corner comes within `tol` of an existing
 *    one, the whole selection shifts so those two coincide EXACTLY. That is
 *    what makes a dropped room actually weld to the wall it was aimed at
 *    instead of landing a few millimetres off and reading as a separate wall.
 * 2. **Alignment tracking** — failing that, each axis is pulled independently
 *    onto a corner that lines up, with a dashed guide back to it, so a room
 *    can be lined up flush with a wall it is not touching.
 *
 * Pure: the tool decides when to call it and the renderer draws the feedback.
 */
export function planDragSnap(
  doc: DrawingDocument,
  moving: ReadonlySet<string>,
  delta: Point,
  tol: number,
): DragSnap {
  const movingNodes: Point[] = [];
  const fixedNodes: { point: Point; entityId: EntityId }[] = [];
  for (const e of doc.all()) {
    if (!hasGrips(e) || !isEntityVisible(doc, e)) continue;
    if (moving.has(e.id as string)) {
      for (const g of e.getGrips()) movingNodes.push(g.point);
    } else {
      for (const g of e.getGrips())
        fixedNodes.push({ point: g.point, entityId: e.id });
    }
  }
  if (movingNodes.length === 0 || fixedNodes.length === 0) {
    return { delta, guides: [], stuck: null };
  }

  const shifted = (p: Point): Point => ({
    x: p.x + delta.x,
    y: p.y + delta.y,
  });

  let best: {
    adjust: Point;
    at: (typeof fixedNodes)[number];
    d: number;
  } | null = null;
  for (const m of movingNodes) {
    const p = shifted(m);
    for (const f of fixedNodes) {
      const d = Math.hypot(f.point.x - p.x, f.point.y - p.y);
      if (d <= tol && (!best || d < best.d)) {
        best = {
          adjust: { x: f.point.x - p.x, y: f.point.y - p.y },
          at: f,
          d,
        };
      }
    }
  }
  if (best) {
    return {
      delta: { x: delta.x + best.adjust.x, y: delta.y + best.adjust.y },
      guides: [],
      stuck: { point: best.at.point, entityId: best.at.entityId },
    };
  }

  let bestX: { shift: number; from: Point; node: Point } | null = null;
  let bestY: { shift: number; from: Point; node: Point } | null = null;
  for (const m of movingNodes) {
    const p = shifted(m);
    for (const f of fixedNodes) {
      const dx = f.point.x - p.x;
      if (
        Math.abs(dx) <= tol &&
        (!bestX || Math.abs(dx) < Math.abs(bestX.shift))
      )
        bestX = { shift: dx, from: f.point, node: p };
      const dy = f.point.y - p.y;
      if (
        Math.abs(dy) <= tol &&
        (!bestY || Math.abs(dy) < Math.abs(bestY.shift))
      )
        bestY = { shift: dy, from: f.point, node: p };
    }
  }
  const shiftX = bestX?.shift ?? 0;
  const shiftY = bestY?.shift ?? 0;
  const guides: AlignGuide[] = [];
  const landed = (node: Point): Point => ({
    x: node.x + shiftX,
    y: node.y + shiftY,
  });
  if (bestX) guides.push({ a: bestX.from, b: landed(bestX.node) });
  if (bestY) guides.push({ a: bestY.from, b: landed(bestY.node) });

  return {
    delta: { x: delta.x + shiftX, y: delta.y + shiftY },
    guides,
    stuck: null,
  };
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
    if (!hasGrips(e) || !isEntityVisible(doc, e)) continue;
    for (const g of e.getGrips()) {
      const p = g.point;
      if (exclude && near(p, exclude)) continue;
      const dx = Math.abs(p.x - point.x);
      if (dx <= tol && (!bestX || dx < bestX.d)) bestX = { at: p, d: dx };
      const dy = Math.abs(p.y - point.y);
      if (dy <= tol && (!bestY || dy < bestY.d)) bestY = { at: p, d: dy };
    }
  }
  const out: Point = {
    x: bestX ? bestX.at.x : point.x,
    y: bestY ? bestY.at.y : point.y,
  };
  const guides: AlignGuide[] = [];
  if (bestX) guides.push({ a: bestX.at, b: { x: out.x, y: out.y } });
  if (bestY) guides.push({ a: bestY.at, b: { x: out.x, y: out.y } });
  return { point: out, guides };
}
