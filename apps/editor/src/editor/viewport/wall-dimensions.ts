import type {
  DrawingDocument,
  EntityId,
  Point,
  ViewDefinition,
} from '@acip/editor-core';
import {
  HostedOpeningEntity,
  WallEntity,
  isEntityVisible,
} from '@acip/editor-core';

/**
 * What a dimension measures. Walls and the openings cut into them share every
 * rule below — the kind only decides how the finished dimension is drawn, so a
 * 0.9 m door is not mistaken for a 0.9 m stretch of wall.
 */
export type DimensionKind = 'wall' | 'opening';

/**
 * One automatic dimension, in world space.
 *
 * `a`, `b` and `length` are derived together from the same two points, so the
 * drawn line and the printed number can never disagree. Everything after that
 * is placement: which way the dimension stands off from what it measures, and
 * which lane it occupies once its neighbours want the same space.
 */
export interface PlanExtent {
  /** what this measures: a wall SEGMENT, or an opening hosted on one */
  readonly entityId: EntityId;
  readonly kind: DimensionKind;
  /** measurement anchors, on the wall's axis: its drawn extent, or an opening's width */
  readonly a: Point;
  readonly b: Point;
  /** distance(a, b) — exactly what the label reads */
  readonly length: number;
  /**
   * The wall's own baseline. Placement is decided from THIS, never from the
   * drawn extent: caps are not part of where a wall is. Two walls at the same
   * position must be recognised as measuring the same thing however each one
   * happens to be capped — a mitered corner reaches past the endpoint while a
   * tee stops short of it, so their extents differ by up to a wall thickness
   * even when the walls sit exactly on top of one another.
   */
  readonly base?: { readonly a: Point; readonly b: Point };
  /** its entity is selected: drawn highlighted, and it wins any de-duplication */
  readonly selected?: boolean;
}

export interface PlanDimension extends PlanExtent {
  /** unit normal the dimension stands off along; points away from the plan */
  readonly side: Point;
  /**
   * Which lane it sits in, counted from the wall outward. 0 is against the
   * wall; each further lane clears the one before it.
   */
  readonly lane: number;
  readonly selected: boolean;
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
export function wallExtent(wall: WallEntity): PlanExtent | null {
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
    entityId: wall.id,
    kind: 'wall',
    a: { x: a.x + ux * min, y: a.y + uy * min },
    b: { x: a.x + ux * max, y: a.y + uy * max },
    length: max - min,
    base: { a, b },
  };
}

/**
 * An opening's WIDTH, measured along its host wall.
 *
 * Read off the opening's own end grips, so the printed number spans exactly
 * the two handles a finger resizes it by — the plan and the grips can never
 * tell different stories. Those points already lie on the host's baseline,
 * which is where placement is decided from, so there is no separate `base` to
 * carry.
 *
 * Returns null for an opening with no host to hang on, or one collapsed to
 * nothing — neither has a span to measure.
 */
export function openingExtent(opening: HostedOpeningEntity): PlanExtent | null {
  const [, low, high] = opening.getGrips();
  if (!low || !high) return null;
  const length = Math.hypot(
    high.point.x - low.point.x,
    high.point.y - low.point.y,
  );
  if (length < 1e-9) return null;
  return {
    entityId: opening.id,
    kind: 'opening',
    a: low.point,
    b: high.point,
    length,
  };
}

/** directions within this many radians of each other share a lane group (~3°) */
const PARALLEL_TOLERANCE = 0.05;
/**
 * Dimensions whose stand-off lines would land within this of each other, in
 * metres, are treated as colliding and pushed to separate lanes. Lanes are
 * assigned in world space so the layout is stable under zoom; the renderer
 * spaces them in pixels.
 */
const LANE_BAND = 0.35;
/** spans within a millimetre of each other measure the same thing */
const SPAN_EPSILON = 1e-3;

interface Placed {
  dim: Omit<PlanDimension, 'lane'>;
  /** angle of the dimension's own direction, folded to [0, π) */
  axis: number;
  /** signed distance from the origin along `side` — which line it sits on */
  offset: number;
  /** extent along the shared axis, for deciding whether two of them overlap */
  from: number;
  to: number;
  lane: number;
}

const dotp = (p: Point, q: Point): number => p.x * q.x + p.y * q.y;

/**
 * Assign each dimension a side and a lane so that no two of them are drawn on
 * top of each other.
 *
 * Deterministic, and driven by the measured segments rather than any bounding
 * box: dimensions are grouped by direction, and within a group two of them
 * collide only if they sit on nearly the same line AND their spans actually
 * overlap along it. Colliding dimensions take the first free lane, in a stable
 * order (by offset, then along the wall), so redrawing the same plan always
 * produces the same layout and moving one wall only reshuffles its neighbours.
 *
 * The wall in the screenshot's middle band — where a room's bottom wall and the
 * next room's top wall run along the same line — is exactly the colliding case:
 * same axis, near-identical offset, overlapping spans, so they get lanes 0 and
 * 1 instead of one illegible overlap. An opening is that same case against its
 * own host: it sits on the wall's line and inside its span, so it lands in the
 * lane beyond whatever the wall took.
 */
export function layOutDimensions(
  dims: readonly PlanExtent[],
  centre: Point,
): PlanDimension[] {
  const placed: Placed[] = [];
  for (const dim of dims) {
    // placement follows the wall, not its caps
    const from = dim.base?.a ?? dim.a;
    const to = dim.base?.b ?? dim.b;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const ux = dx / len;
    const uy = dy / len;

    // Everything below is measured against the axis, not the wall's own a→b
    // direction: two walls on one line must land in the same group whichever
    // way each of them happens to have been drawn.
    let axis = Math.atan2(uy, ux);
    if (axis < 0) axis += Math.PI;
    if (axis >= Math.PI - 1e-9) axis = 0;
    const normal = { x: -Math.sin(axis), y: Math.cos(axis) };
    const along = { x: Math.cos(axis), y: Math.sin(axis) };

    // stand off on the side away from the middle of the plan, so dimensions
    // ring the drawing instead of falling across the rooms
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const outward = dotp({ x: mid.x - centre.x, y: mid.y - centre.y }, normal);
    const side = outward < 0 ? { x: -normal.x, y: -normal.y } : { ...normal };

    placed.push({
      dim: { ...dim, side, selected: dim.selected ?? false },
      axis,
      offset: dotp(mid, normal),
      from: Math.min(dotp(from, along), dotp(to, along)),
      to: Math.max(dotp(from, along), dotp(to, along)),
      lane: 0,
    });
  }

  // Fully ordered, so the same geometry always lays out the same way however
  // the walls happen to be ordered in the document. The id is the last resort
  // — two dimensions can genuinely share an axis, offset and span.
  placed.sort(
    (p, q) =>
      p.axis - q.axis ||
      p.offset - q.offset ||
      p.from - q.from ||
      q.to - p.to ||
      (p.dim.entityId < q.dim.entityId ? -1 : 1),
  );

  // Two walls measuring the SAME span on the same axis print the same number
  // twice — a room's top and bottom edge, or the left and right walls of a
  // band. One of them is enough, and a selected wall keeps its own so the
  // highlight always has something to land on.
  const unique: Placed[] = [];
  for (const item of placed) {
    const twin = unique.findIndex(
      (other) =>
        Math.abs(other.axis - item.axis) <= PARALLEL_TOLERANCE &&
        Math.abs(other.from - item.from) <= SPAN_EPSILON &&
        Math.abs(other.to - item.to) <= SPAN_EPSILON,
    );
    if (twin < 0) unique.push(item);
    else if (item.dim.selected && !unique[twin].dim.selected) {
      unique[twin] = item;
    }
  }

  const done: Placed[] = [];
  for (const item of unique) {
    const clashes = done.filter((other) => {
      const parallel =
        Math.abs(other.axis - item.axis) <= PARALLEL_TOLERANCE ||
        Math.abs(Math.abs(other.axis - item.axis) - Math.PI) <=
          PARALLEL_TOLERANCE;
      if (!parallel) return false;
      // dimensions standing off opposite ways cannot cover each other, so the
      // two sides of a room keep their own side instead of stacking
      if (dotp(other.dim.side, item.dim.side) <= 0) return false;
      // offsets are measured against the axis normal, so two walls on one line
      // read as one line however each was drawn
      if (Math.abs(other.offset - item.offset) > LANE_BAND) return false;
      // no overlap along the shared axis = no collision, whatever the offset
      return other.to > item.from + 1e-9 && item.to > other.from + 1e-9;
    });
    const taken = new Set(clashes.map((other) => other.lane));
    while (taken.has(item.lane)) item.lane += 1;
    done.push(item);
  }

  return done
    .sort((p, q) => (p.dim.entityId < q.dim.entityId ? -1 : 1))
    .map((item) => ({ ...item.dim, lane: item.lane }));
}

/** the mean of the dimension midpoints — the plan's middle, for side picking */
function centreOf(dims: readonly { a: Point; b: Point }[]): Point {
  let x = 0;
  let y = 0;
  for (const dim of dims) {
    x += (dim.a.x + dim.b.x) / 2;
    y += (dim.a.y + dim.b.y) / 2;
  }
  return { x: x / dims.length, y: y / dims.length };
}

/**
 * Every wall on the view's level with its overall extent, every opening in
 * those walls with its width, each carrying the side and lane it is drawn in.
 * Recomputed from the document on every call, so any geometry change — a wall
 * moved, resized, split at a new crossing, a window widened, added or erased —
 * lays the dimensions out afresh.
 *
 * Openings are reached through their hosts rather than scanned for, because
 * the host is what puts them on a level at all: nothing about a window says
 * which storey it belongs to.
 *
 * Hidden entities are measured by nobody. A dimension is drawn linework like
 * any other, and one standing off a wall that is not on the screen is a number
 * hanging in space — which is exactly what a closed danger zone used to leave
 * behind. An opening is checked on its own account as well as its host's: it
 * can sit on a layer of its own.
 */
export function planDimensions(
  doc: DrawingDocument,
  view: ViewDefinition,
  selection: ReadonlySet<string> = new Set(),
): PlanDimension[] {
  // plan-only; the 3D view definition carries no level
  if (view.kind !== 'plan') return [];
  const levelId = view.levelId ?? null;
  const walls: PlanExtent[] = [];
  const openings: PlanExtent[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof WallEntity)) continue;
    if ((entity.baseLevelId ?? null) !== levelId) continue;
    if (!isEntityVisible(doc, entity)) continue;
    const dim = wallExtent(entity);
    if (dim) walls.push({ ...dim, selected: selection.has(entity.id) });
    for (const hostedId of doc.relations.dependentsOf(entity.id)) {
      const hosted = doc.get(hostedId);
      if (!(hosted instanceof HostedOpeningEntity)) continue;
      if (!isEntityVisible(doc, hosted)) continue;
      const span = openingExtent(hosted);
      if (span) openings.push({ ...span, selected: selection.has(hostedId) });
    }
  }
  if (walls.length === 0) return [];
  // the middle is the PLAN's, taken from the walls alone: cutting a window
  // must not tug the centre far enough to flip which side a wall's dimension
  // stands off on
  return layOutDimensions([...walls, ...openings], centreOf(walls));
}
