import type {
  Arc,
  DrawingDocument,
  EntityId,
  Point,
  ViewDefinition,
} from '@acip/editor-core';
import {
  HostedOpeningEntity,
  WallEntity,
  arcSagitta,
  distance,
  isEntityVisible,
} from '@acip/editor-core';
import type { MeasureMode } from '../ui-state';

/**
 * What a dimension measures. Walls and the openings cut into them share every
 * rule below — the kind only decides how the finished dimension is drawn, so a
 * 0.9 m door is not mistaken for a 0.9 m stretch of wall.
 */
export type DimensionKind = 'wall' | 'opening';

/**
 * One FACE of a wall, as the stretch of the wall's own AXIS that face covers.
 *
 * A wall has two, and neither of them is "the inside" on its own: which face a
 * tape runs along depends on which room the person holding it is standing in.
 * So both are carried, each with the unit normal it lies on, and the choice is
 * left to the pass that already knows which way the plan is being read from.
 *
 * The anchors are projected back onto the BASELINE rather than left out on the
 * face itself. The face only decides WHAT is measured — where the wall stops
 * being wall — while where the dimension is drawn stays the wall's own line,
 * so an inner and an outer dimension of the same wall still line up with each
 * other and with everything else anchored on that line.
 */
export interface FaceExtent {
  /** unit normal from the baseline out to this face — which side it lies on */
  readonly normal: Point;
  readonly a: Point;
  readonly b: Point;
  /** distance(a, b) on a straight wall; the arc length of `curve` when it bows */
  readonly length: number;
  /** the bowed boundary this face runs along; absent on a straight wall */
  readonly curve?: ArcExtent;
}

/**
 * The curved boundary a dimension follows, when what is being measured bows.
 *
 * Concentric with the wall's own centreline arc — same centre, same angular
 * extent, one radius further out or in — so it is the wall's geometry read at
 * an offset rather than a second account of where the wall is. That is the
 * whole point: a chord is not a wall, and the number beside a bowed wall has
 * to be the length of the boundary a tape would actually run along.
 */
export interface ArcExtent {
  readonly centre: Point;
  /** of THIS boundary: the centreline radius, plus or minus half a thickness */
  readonly radius: number;
  /** angle of `a` about the centre */
  readonly startAngle: number;
  /**
   * Signed angular extent, in core's convention: the boundary runs a → b as
   * the angle turns from `startAngle` by MINUS this. Its sign says which way
   * the wall bows, so nothing downstream has to guess an orientation.
   */
  readonly sweep: number;
  /** the point halfway along — where the label sits and the depth arrow lands */
  readonly apex: Point;
  /** rise from the chord between the two anchors to the apex; never negative */
  readonly depth: number;
}

/** parallel within this many radians counts as "runs straight through" (~0.6°) */
const THROUGH_TOLERANCE = 0.01;

/**
 * How far short of one END of the baseline a CLEAR width has to stop, because
 * another wall crosses there.
 *
 * A wall standing across this one at angle θ, of half-thickness h, presents its
 * near face `h / |sin θ|` back along this wall's axis — the offset at which
 * this axis crosses that face line. Perpendicular is the common case and gives
 * exactly the half-thickness.
 *
 * This is what a mitered corner already does to the inner face for free. It has
 * to be worked out separately for the junction a wall runs STRAIGHT THROUGH:
 * WALL.RESOLVE splits a wall wherever a partition tees into it, and each half
 * then runs to the junction POINT — the partition's centreline. A clear width
 * that swallows half a partition is not a width anybody can build to, and it is
 * the reason three bays under one 5.70 m wall used to add up to exactly 5.70.
 *
 * A neighbour running straight through is skipped: two collinear halves of what
 * the user drew as one wall do not obstruct each other. The largest setback
 * wins — a span stops at the first thing it runs into, not the last.
 */
/**
 * What a wall MEASURES, given the span between its endpoints.
 *
 * The dimension lane and the drag readout used to answer this differently, so
 * the same wall read 4.30 in the lane and 4.00 under the finger — and neither
 * number was wrong, they were two conventions with nothing saying which was
 * being used. A baseline runs centreline to centreline; what gets dimensioned
 * is the wall's own extent, which reaches half a thickness FURTHER at each end
 * on the outside and stops half a thickness SHORTER at each end on the inside.
 *
 * Half at each end is a whole thickness either way, which is why a 4.00 m
 * baseline through 0.30 m walls dimensions as 4.30 outside and 3.70 inside.
 *
 * Stated once, as arithmetic over two numbers, so a drag and a lane cannot
 * drift apart again — and so the drag needs nothing from the junctions, which
 * are themselves moving while it happens.
 */
export function dimensionedSpan(
  baseline: number,
  thickness: number,
  mode: MeasureMode,
): number {
  const span = mode === 'inside' ? baseline - thickness : baseline + thickness;
  // a wall shorter than it is thick has no clear span to report; the drawn
  // extent beats a negative number
  return Math.max(0, span);
}

export function setbackAt(wall: WallEntity, which: 'start' | 'end'): number {
  const { a, b } = wall.getBaseline();
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  if (len < 1e-9) return 0;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;

  let most = 0;
  for (const join of wall.getJoinsAt(which)) {
    const other = join.wall.getBaseline();
    const vlen = Math.hypot(other.b.x - other.a.x, other.b.y - other.a.y);
    if (vlen < 1e-9) continue;
    // the neighbour's own normal, dotted with this axis: |sin θ| by another name
    const nx = -(other.b.y - other.a.y) / vlen;
    const ny = (other.b.x - other.a.x) / vlen;
    const sin = Math.abs(ux * nx + uy * ny);
    if (sin <= THROUGH_TOLERANCE) continue;
    const cut = join.wall.getThickness() / 2 / sin;
    if (cut > most) most = cut;
  }
  return most;
}

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
  /**
   * The same thing measured along each of its two faces, for whoever wants the
   * inner clear width instead of the overall extent. Present only when there
   * ARE two sides to choose between: an opening carries none, because a hole is
   * the same width whichever face of the wall you hold the tape against.
   */
  readonly faces?: readonly FaceExtent[];
  /**
   * The bowed boundary this dimension measures, when it bows. A straight wall
   * carries none, and every reader treats its absence as "this is a straight
   * dimension" — which is what keeps the straight case exactly as it was.
   */
  readonly curve?: ArcExtent;
  /**
   * How far short of each end of `base` a CLEAR width must stop, because
   * something crosses the wall there. See `setbackAt`.
   *
   * Kept apart from `faces` rather than baked into them, because it applies to
   * the inner face and not to the outer one: a partition tee'd into a wall
   * stands on ONE side of it, so it interrupts the room's face while the far
   * face runs past the junction untouched. Baking it in shortened both, which
   * made a wall's outer face report the clear width — harmless where it is
   * read today, wrong for anyone who reads it tomorrow.
   */
  readonly setback?: { readonly start: number; readonly end: number };
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
 * How far along the wall a point sits, as a fraction of the whole sweep: 0 at
 * the start of the baseline, 1 at its end.
 *
 * This is the bowed wall's answer to "project the corner onto the axis", which
 * is what the straight path does with every outline corner. An angle about the
 * centre IS the arc's own parameter, so a mitered cap reaching past the end of
 * the wall, or a tee stopping short of it, lands outside or inside [0, 1]
 * exactly as its projection would on a straight wall.
 *
 * Folded onto the branch around the middle of the wall rather than taken raw,
 * because an angle is only known modulo a turn and a cap can sit either side of
 * either end. A sweep is clamped short of a full turn, so that branch always
 * has room for the whole wall.
 */
function arcProgress(arc: Arc, p: Point): number {
  const raw =
    (arc.startAngle - Math.atan2(p.y - arc.center.y, p.x - arc.center.x)) /
    arc.sweep;
  const period = (Math.PI * 2) / Math.abs(arc.sweep);
  return raw - period * Math.round((raw - 0.5) / period);
}

/**
 * One boundary of a bowed wall: the stretch of it between `from` and `to`,
 * both in the 0..1 of `arcProgress`.
 *
 * `offset` is how far the boundary lies off the centreline along the wall's own
 * `face+` normal — half a thickness one way for one face, the other way for the
 * other. Which of the two is "inside" is not decided here: that is the plan's
 * business, and the layout pass already knows it.
 *
 * ARC LENGTH, never the chord: radius times the angle turned, on the radius of
 * THIS boundary. The depth is the sagitta of the same stretch, taken from the
 * geometry package's own arcSagitta rather than worked out again here.
 *
 * Null when the boundary has collapsed — a bend tight enough that the inner
 * face has no radius left to run along. The caller then has no curve to offer
 * and the face is dropped, exactly as a collapsed straight face is.
 */
function boundaryExtent(
  arc: Arc,
  offset: number,
  from: number,
  to: number,
): ArcExtent | null {
  // the centre sits away from the bulge, so the face a wall bows TOWARD is the
  // one further from it: that is what the sweep's sign is saying here
  const radius = arc.radius + Math.sign(arc.sweep) * offset;
  const sweep = arc.sweep * (to - from);
  if (radius <= 1e-9 || Math.abs(sweep) < 1e-9) return null;

  const at = (u: number): Point => {
    const phi = arc.startAngle - arc.sweep * u;
    return {
      x: arc.center.x + radius * Math.cos(phi),
      y: arc.center.y + radius * Math.sin(phi),
    };
  };
  const a = at(from);
  const b = at(to);
  return {
    centre: arc.center,
    radius,
    startAngle: arc.startAngle - arc.sweep * from,
    sweep,
    apex: at((from + to) / 2),
    depth: Math.abs(arcSagitta(distance(a, b), sweep)),
  };
}

/** a boundary turned into the anchors and length a dimension is made of */
function arcAnchors(curve: ArcExtent): {
  a: Point;
  b: Point;
  length: number;
  curve: ArcExtent;
} {
  const end = curve.startAngle - curve.sweep;
  return {
    a: {
      x: curve.centre.x + curve.radius * Math.cos(curve.startAngle),
      y: curve.centre.y + curve.radius * Math.sin(curve.startAngle),
    },
    b: {
      x: curve.centre.x + curve.radius * Math.cos(end),
      y: curve.centre.y + curve.radius * Math.sin(end),
    },
    length: curve.radius * Math.abs(curve.sweep),
    curve,
  };
}

/**
 * Overall extent of a BOWED wall, measured round the wall rather than across
 * the chord it leaves behind.
 *
 * The same shape of answer the straight path gives, arrived at the same way:
 * the wall's own drawn outline is walked, every corner is placed along the wall
 * and sorted onto the face it belongs to, and each face is then measured end to
 * end. Only the two words change — "along the wall" is an angle about the arc's
 * centre instead of a distance along the axis, and "which face" is which side of
 * the centreline RADIUS a corner falls on instead of which side of the baseline.
 *
 * Both have to change, and both for the same reason: a bow puts its inner face
 * on the far side of its own chord, so which side of that chord a corner sits
 * on says nothing about which face it came from, and how far along the chord it
 * projects says nothing about how much wall is behind it.
 *
 * Caps therefore still count for exactly what they counted for before. A wall
 * mitered into a corner has its faces cut where core drew them, so an inner arc
 * that stops short of the baseline endpoint measures short — which is what a
 * clear width IS.
 *
 * The top-level length stays the CENTRELINE arc: how much wall there is, the
 * answer for a caller that has not chosen a side. Both modes pick a face over
 * it, the same way both modes already pick one on a straight wall.
 */
function curvedWallExtent(wall: WallEntity, arc: Arc): PlanExtent | null {
  const { a, b } = wall.getBaseline();
  const chord = distance(a, b);
  if (chord < 1e-9) return null;
  const spine = boundaryExtent(arc, 0, 0, 1);
  if (!spine) return null;

  const half = wall.getThickness() / 2;
  const plus: number[] = [];
  const minus: number[] = [];
  for (const corner of wall.getOutline()) {
    // + is the face the wall bows toward when it bows to face+, which is the
    // side further from the centre; the sweep's sign carries the rest
    const radial =
      (distance(corner, arc.center) - arc.radius) * Math.sign(arc.sweep);
    (radial >= 0 ? plus : minus).push(arcProgress(arc, corner));
  }

  // the chord's normal, which is the side a face is ON as far as the rest of
  // the model is concerned — the same convention rooms assign faces by
  const nx = -(b.y - a.y) / chord;
  const ny = (b.x - a.x) / chord;

  const face = (us: number[], sign: 1 | -1): FaceExtent | null => {
    if (us.length < 2) return null;
    const curve = boundaryExtent(
      arc,
      sign * half,
      Math.min(...us),
      Math.max(...us),
    );
    if (!curve) return null;
    return { normal: { x: nx * sign, y: ny * sign }, ...arcAnchors(curve) };
  };

  return {
    entityId: wall.id,
    kind: 'wall',
    ...arcAnchors(spine),
    base: { a, b },
    faces: [face(plus, 1), face(minus, -1)].filter(
      (item): item is FaceExtent => item !== null,
    ),
    setback: { start: setbackAt(wall, 'start'), end: setbackAt(wall, 'end') },
  };
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
 * The same projection also yields each FACE's span, which is what an inner
 * clear width is made of: the outline's corners are split by which side of the
 * baseline they fall on, and each side is measured on its own. A free-standing
 * wall's butt caps square off both faces at once, so its two faces span the
 * same stretch and inside reads exactly the same as outside — correct, and the
 * reason nothing here special-cases it.
 *
 * Returns null for a degenerate wall, which has no direction to measure along.
 */
export function wallExtent(wall: WallEntity): PlanExtent | null {
  // A bowed wall has no axis to project onto, and everything below projects
  // onto one. It is measured round its own arc instead, by the same rules.
  const arc = wall.getArc();
  if (arc) return curvedWallExtent(wall, arc);

  const { a, b } = wall.getBaseline();
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length < 1e-9) return null;
  const ux = dx / length;
  const uy = dy / length;
  // left of baseline travel — the face+ side, the convention the whole model
  // already reads sides by (docs/editor-core/04-systems/spaces.md)
  const nx = -uy;
  const ny = ux;

  let min = Infinity;
  let max = -Infinity;
  // Corners are sorted onto their face by WHICH SIDE OF THE BASELINE they fall
  // on, not by their index in the outline. A join cap replaces corners rather
  // than offsetting them, and a miter clamped at the spike limit is pulled off
  // its face line entirely — but never across the baseline, because the clamp
  // pulls it towards the junction and the junction sits on that line. The sign
  // survives everything the cap mathematics can do; a fixed index does not.
  const plus: number[] = [];
  const minus: number[] = [];
  for (const corner of wall.getOutline()) {
    const px = corner.x - a.x;
    const py = corner.y - a.y;
    const s = px * ux + py * uy;
    if (s < min) min = s;
    if (s > max) max = s;
    (px * nx + py * ny >= 0 ? plus : minus).push(s);
  }
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return null;

  // A face needs two corners with real distance between them to be a length.
  // Anything less is dropped rather than reported as a span of nothing: a wall
  // of no thickness puts every corner on one side, and a corner clamped hard
  // enough can collapse the face it belonged to. Dropping it lets the caller
  // fall back to the overall extent instead of drawing a zero.
  const faceSpan = (offsets: number[], sign: number): FaceExtent | null => {
    if (offsets.length < 2) return null;
    const lo = Math.min(...offsets);
    const hi = Math.max(...offsets);
    if (hi - lo < 1e-9) return null;
    return {
      normal: { x: nx * sign, y: ny * sign },
      a: { x: a.x + ux * lo, y: a.y + uy * lo },
      b: { x: a.x + ux * hi, y: a.y + uy * hi },
      length: hi - lo,
    };
  };

  return {
    entityId: wall.id,
    kind: 'wall',
    a: { x: a.x + ux * min, y: a.y + uy * min },
    b: { x: a.x + ux * max, y: a.y + uy * max },
    length: max - min,
    base: { a, b },
    faces: [faceSpan(plus, 1), faceSpan(minus, -1)].filter(
      (face): face is FaceExtent => face !== null,
    ),
    // asked once per wall rather than once per face: whatever crosses an end
    // crosses it at one place, and walking the joins is the expensive part
    setback: { start: setbackAt(wall, 'start'), end: setbackAt(wall, 'end') },
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
 * No faces either, and deliberately so: an opening is a hole, and a hole is the
 * same width measured against the near face of the wall as against the far one.
 * There is nothing for inside mode to choose between, so an opening prints the
 * same number in both modes — the wall around it changes, its door does not.
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
 * Which of two dimensions in the same place gets to print its number. Only
 * called for a pair already known to sit on one line over one stretch of it,
 * so the two are drawn on top of each other and only one number can be read.
 *
 * A selection always wins, so the highlight has something to land on. Failing
 * that the longer extent wins: a wall drawn over the locked original plan
 * takes its own caps and so falls short of it by a miter, and the shorter
 * label would read as a dimension stopping before the linework it measures.
 */
function beats(item: Placed, other: Placed): boolean {
  if (item.dim.selected !== other.dim.selected) return item.dim.selected;
  return item.dim.length > other.dim.length + SPAN_EPSILON;
}

/**
 * The face a tape held inside the room would run along: the one facing INTO
 * the plan, against `outward`.
 *
 * `outward` already answers "which way is out of the plan", so the inner face is
 * simply the face whose normal points most against it. That keeps ONE notion of
 * outside in this file instead of inventing a second one.
 *
 * Null when the wall offers no such face — a wall of no thickness has only one,
 * and a face can collapse under a hard-clamped miter. The caller then measures
 * the wall as drawn: a wall labelled with its overall extent is a far better
 * plan than a wall labelled with nothing, or with a zero.
 */
function innerFace(dim: PlanExtent, outward: Point): FaceExtent | null {
  let best: FaceExtent | null = null;
  for (const face of dim.faces ?? []) {
    if (!best || dotp(face.normal, outward) < dotp(best.normal, outward)) {
      best = face;
    }
  }
  if (!best || dotp(best.normal, outward) >= 0) return null;
  // A bowed face is already cut where core drew its caps, and `clear` is
  // straight-line arithmetic along the baseline: applied to an arc it would
  // throw the measured boundary back onto the chord it is there to avoid.
  return best.curve ? best : clear(dim, best);
}

/**
 * The face a tape held OUTSIDE the plan would run along: the mirror of
 * `innerFace`, the one facing away from the plan's middle.
 *
 * Only a BOWED wall asks for it. A straight wall's outside dimension is its
 * overall drawn extent and stays exactly that — outer corner to outer corner,
 * caps and all — because on a straight wall the outer face and that extent are
 * the same stretch of the same line. On a bow they are not even the same
 * LENGTH: the outer boundary is a longer arc than the centreline, and the
 * drawn extent is the projection onto a chord that is shorter than either.
 *
 * Null when the wall offers no such face, which sends the caller back to the
 * extent — the same fallback inside mode has always had.
 */
function outerFace(dim: PlanExtent, outward: Point): FaceExtent | null {
  let best: FaceExtent | null = null;
  for (const face of dim.faces ?? []) {
    if (!best || dotp(face.normal, outward) > dotp(best.normal, outward)) {
      best = face;
    }
  }
  return best && dotp(best.normal, outward) > 0 ? best : null;
}

/**
 * The inner face cut back to what actually crosses it — the clear width proper.
 *
 * Applied here rather than in `wallExtent` because it belongs to the INNER face
 * alone (see `PlanExtent.setback`), and which face that is is not known until
 * the plan's middle has been. At a mitered corner the miter has already cut to
 * the same place, so the clamp is a no-op there; it earns its keep only at a
 * junction the wall runs straight through.
 *
 * Everything is measured along `base`, which is the wall's own line, so the
 * face's anchors — already projected back onto it — stay comparable. A cut that
 * would leave nothing is refused: a wall shorter than the walls crossing it has
 * no clear width, and its drawn extent is a better answer than a zero.
 */
function clear(dim: PlanExtent, face: FaceExtent): FaceExtent {
  const base = dim.base;
  const cut = dim.setback;
  if (!base || !cut) return face;
  const dx = base.b.x - base.a.x;
  const dy = base.b.y - base.a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return face;
  const ux = dx / len;
  const uy = dy / len;
  const at = (p: Point) => (p.x - base.a.x) * ux + (p.y - base.a.y) * uy;

  const lo = Math.max(Math.min(at(face.a), at(face.b)), cut.start);
  const hi = Math.min(Math.max(at(face.a), at(face.b)), len - cut.end);
  if (hi - lo < 1e-9) return face;
  return {
    normal: face.normal,
    a: { x: base.a.x + ux * lo, y: base.a.y + uy * lo },
    b: { x: base.a.x + ux * hi, y: base.a.y + uy * hi },
    length: hi - lo,
  };
}

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
 *
 * `mode` decides what each dimension measures AND which way it stands off, and
 * the two are the same decision: an inside dimension is drawn inside. A clear
 * width printed out beyond the outer face is a number floating over the wrong
 * side of the wall it describes — you cannot lay a tape where it is drawn — so
 * inside mode turns the stand-off inward, into the room the number belongs to.
 *
 * Which face is inner is settled from `outward` rather than from the drawn side,
 * so it is one answer either way: the face pointing INTO the plan. Only the
 * drawing of it flips. Lanes are still assigned from the baselines, so the same
 * plan still lays out deterministically in both modes.
 */
export function layOutDimensions(
  dims: readonly PlanExtent[],
  centre: Point,
  mode: MeasureMode = 'outside',
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

    // which way is out of the plan — the one notion of "outside" everything
    // below is decided from
    const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
    const away = dotp({ x: mid.x - centre.x, y: mid.y - centre.y }, normal);
    const outward = away < 0 ? { x: -normal.x, y: -normal.y } : { ...normal };

    // Inside mode re-measures against the inner face. The anchors and the
    // length move together, from the same two points, because the drawn line
    // and the printed number are one thing: a face's span with the extent's
    // number against it would be a dimension lying about what it spans.
    const inner = mode === 'inside' ? innerFace(dim, outward) : null;
    /*
     * Outside mode on a BOWED wall measures its outer boundary, for the same
     * reason inside mode measures the inner one: the two are different arcs of
     * different lengths, and the drawn extent — a projection onto the chord —
     * is neither of them. Straight walls never reach this line and keep the
     * overall extent they have always been given.
     */
    const outer =
      mode === 'outside' && dim.curve ? outerFace(dim, outward) : null;
    const chosen = inner ?? outer;
    // and it is drawn on that same side. Outside rings the drawing so the
    // dimensions do not fall across the rooms; inside deliberately does fall
    // across them, because that is where the width being quoted is.
    const side =
      mode === 'inside'
        ? { x: -outward.x, y: -outward.y }
        : { x: outward.x, y: outward.y };
    const measured: PlanExtent = chosen
      ? {
          ...dim,
          a: chosen.a,
          b: chosen.b,
          length: chosen.length,
          // the boundary that was measured is the boundary that gets drawn,
          // so the line and the number stay one answer
          curve: chosen.curve,
        }
      : dim;

    placed.push({
      dim: { ...measured, side, selected: dim.selected ?? false },
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

  // Two walls in the SAME PLACE print the same number twice — one wall drawn
  // over another, which is what the danger zone does on purpose. One of them
  // is enough.
  //
  // Same place means the same line as well as the same stretch of it. Sharing
  // a span is not sharing a position: the three horizontal walls of a stacked
  // pair of rooms run between the same two x values at three different heights
  // and measure three different lengths, and dropping two of them left the
  // plan claiming its middle wall was as long as its outer one. Parallel
  // neighbours are what LANES are for — they are drawn, spaced apart.
  const unique: Placed[] = [];
  for (const item of placed) {
    const twin = unique.findIndex(
      (other) =>
        Math.abs(other.axis - item.axis) <= PARALLEL_TOLERANCE &&
        Math.abs(other.offset - item.offset) <= SPAN_EPSILON &&
        Math.abs(other.from - item.from) <= SPAN_EPSILON &&
        Math.abs(other.to - item.to) <= SPAN_EPSILON,
    );
    if (twin < 0) unique.push(item);
    else if (beats(item, unique[twin])) unique[twin] = item;
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
 *
 * `mode` defaults to the overall extents, which is what the plan measured
 * before there was a choice: a caller that has not heard of the setting must
 * keep getting the drawing it always got.
 */
export function planDimensions(
  doc: DrawingDocument,
  view: ViewDefinition,
  selection: ReadonlySet<string> = new Set(),
  mode: MeasureMode = 'outside',
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
  return layOutDimensions([...walls, ...openings], centreOf(walls), mode);
}

/**
 * The number the plan is PRINTING against one wall right now.
 *
 * Not a shortcut for `wallExtent(wall).length` — it goes the long way round, on
 * purpose. Which face inside mode measures is decided from the plan's centre,
 * so it cannot be worked out from a wall on its own; and a dialog that offers
 * to edit "the length" while showing a different number than the drawing does
 * is worse than one that offers nothing. Running the whole layout and reading
 * the answer off it makes the two the same computation rather than two
 * computations that have to be kept in agreement.
 *
 * Null for a wall the plan labels with nothing at all — hidden, on another
 * level, degenerate. A wall dropped as a TWIN is the interesting case: it draws
 * no dimension of its own because another wall is printing the same number in
 * the same place, so its drawn extent is the honest answer and it falls back to
 * that rather than to nothing.
 */
export function labelledWallLength(
  doc: DrawingDocument,
  view: ViewDefinition,
  wall: WallEntity,
  mode: MeasureMode = 'outside',
): number | null {
  if (!isEntityVisible(doc, wall)) return null;
  const drawn = planDimensions(doc, view, new Set(), mode).find(
    (dim) => dim.kind === 'wall' && dim.entityId === wall.id,
  );
  return drawn ? drawn.length : (wallExtent(wall)?.length ?? null);
}
