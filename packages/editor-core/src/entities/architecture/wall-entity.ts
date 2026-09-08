import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  distance,
  dot,
  lerp,
  midpoint,
  normalize,
  perpendicular,
  point,
  scale,
  sub,
} from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import {
  closestPointOnSegment,
  distanceToSegment,
} from '../../geometry/curves/segment.js';
import { distanceToPolyline } from '../../geometry/curves/polyline.js';
import type { Arc } from '../../geometry/curves/arc.js';
import {
  arcFromChord,
  arcNormalAt,
  arcPointAt,
  arcTangentAt,
  clampSweep,
  sweepFromApex,
  sweepFromCenter,
  tessellateArc,
} from '../../geometry/curves/arc.js';
import type { Geometry, RegionShape } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import {
  extrudePolygon,
  extrudeQuad,
  mergeMeshes,
} from '../../geometry/mesh/index.js';
import type { Interval } from '../../topology/intervals.js';
import { subtractIntervals } from '../../topology/intervals.js';
import type { EndCap, WallEnd } from '../../topology/junctions.js';
import {
  JOIN_TOLERANCE,
  resolveJunction,
  resolveTeeCap,
} from '../../topology/junctions.js';
import type { BBox } from '../../geometry/primitives/bbox.js';
import {
  bboxExpand,
  bboxFromPoints,
  bboxUnion,
} from '../../geometry/primitives/bbox.js';
import type {
  Anchor,
  GripPoint,
  IGrippable,
  IHost,
  ILevelAware,
  IMeshable,
  OpeningSpec,
} from '../base/capabilities.js';
import { cutsOpening } from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';
import { isEntityInteractive, isEntityVisible } from '../../views/index.js';

/** which end of a wall's baseline — `start` is `a`, `end` is `b` */
export type WallEndSide = 'start' | 'end';

/**
 * One wall found joined to an end of another wall.
 *
 * `corner` — the two walls share that endpoint and miter against each other.
 * `tee` — this end lands on the other wall's BODY and butts its near face;
 * the tee'd wall stops short, the continuous one is untouched.
 */
export interface WallJoin {
  readonly wall: WallEntity;
  readonly kind: 'corner' | 'tee';
}

/**
 * First semantic entity: baseline + thickness + height. Hosts openings
 * (windows, doors) on its axis anchor; effective plan geometry is the solid
 * spans between openings; 3D is a straight extrusion with opening bands.
 */
export class WallEntity
  extends Entity
  implements IHost, ILevelAware, IMeshable, IGrippable
{
  static readonly TYPE = 'wall';

  readonly type: string = WallEntity.TYPE;

  private a: Point = point(0, 0);
  private b: Point = point(1, 0);
  /**
   * Per-corner JOG: how far this end steps sideways, in meters, signed along
   * the wall's +normal. Zero — the default — means no jog and nothing about
   * the wall changes.
   *
   * This is the per-corner override wall-joins.md deferred beyond V2: a
   * stored wall property read by the resolver. It is the one piece of a
   * junction the user states rather than the drawing deriving, and it is
   * stored on the END rather than on the junction because a junction is
   * derived and has nowhere to keep anything.
   *
   * The BASELINE never moves. A jog changes only how the wall is drawn, so
   * join discovery, snapping, dimensions and grips all keep working off the
   * same two points they always did.
   */
  private jogs: { start: number; end: number } = { start: 0, end: 0 };
  /**
   * How far this wall TURNS between its two endpoints, in radians, signed
   * toward `face+`. Zero — the default — is a straight wall and costs nothing.
   *
   * Chord-and-sweep rather than centre-and-radius, for the same reason a jog
   * does not move the baseline: the two endpoints stay the fixed, stored truth
   * of where this wall begins and ends, so joins, grips, snapping and the
   * neighbours welded to it all keep working off exactly the points they
   * always did. The centre is derived, and a gentle curve has one hundreds of
   * meters off the plan — not something to store, and not something to hold on
   * to while the endpoints move.
   */
  private sweep = 0;
  thickness = 0.3;
  baseLevelId: LevelId | null = null;
  vertical: { height: number } = { height: 3 };

  getBaseline(): { a: Point; b: Point } {
    return { a: this.a, b: this.b };
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setBaseline(a: Point, b: Point): void {
    this.a = a;
    this.b = b;
  }

  /** how far this end steps sideways; 0 when it does not */
  getJog(which: WallEndSide): number {
    return this.jogs[which];
  }

  /**
   * Step this end sideways, or pass 0 to take the jog off and let the corner
   * go back to mitering.
   */
  setJog(which: WallEndSide, offset: number): void {
    this.jogs[which] = Number.isFinite(offset) ? offset : 0;
  }

  /** how far the wall turns, in radians; 0 when it is straight */
  getSweep(): number {
    return this.sweep;
  }

  /** curve the wall, or pass 0 to straighten it back out */
  setSweep(sweep: number): void {
    this.sweep = clampSweep(sweep);
  }

  /**
   * The arc this wall runs along, or null when it is straight.
   *
   * Derived on every read rather than stored, exactly like a join: the arc is
   * a consequence of the two endpoints and the sweep, and the moment an
   * endpoint is dragged the old centre is wrong. Cheap trigonometry, and the
   * alternative is a cached centre that is right until it silently is not.
   */
  private arc(): Arc | null {
    return arcFromChord(this.a, this.b, this.sweep);
  }

  /** does this wall curve at all? */
  isCurved(): boolean {
    return this.arc() !== null;
  }

  /**
   * The centreline as a polyline: two points when straight, a tessellated run
   * when curved.
   *
   * Public because the things that reason about a plan's TOPOLOGY — room
   * detection above all — work in straight segments and should keep doing so.
   * Handing them the curve already broken into segments is what lets a curved
   * wall bound a room without the arrangement ever learning what an arc is.
   */
  getCentreline(): Point[] {
    const arc = this.arc();
    if (!arc) return [this.a, this.b];
    return tessellateArc(arc, 0, arc.length);
  }

  /**
   * ARC length when curved, which is what the wall is actually made of: it is
   * the number the takeoff prices, the number a dimension prints, and the
   * number openings are placed along.
   */
  getLength(): number {
    return this.arc()?.length ?? distance(this.a, this.b);
  }

  /** the centreline point at distance `s` from the start */
  private pointAt(s: number): Point {
    const arc = this.arc();
    if (arc) return arcPointAt(arc, s);
    const len = distance(this.a, this.b);
    return len === 0 ? this.a : lerp(this.a, this.b, s / len);
  }

  /** the outward (`face+`) normal at distance `s`, which turns along a curve */
  private normalAt(s: number): Vector {
    const arc = this.arc();
    return arc ? arcNormalAt(arc, s) : this.normal();
  }

  /**
   * Where to sample the centreline across [s0, s1].
   *
   * Two points when straight — the ends, and nothing in between, so a straight
   * wall produces the very same four-cornered quad it always did. A curve gets
   * as many as its curvature asks for.
   */
  private samplesAcross(s0: number, s1: number): number[] {
    const arc = this.arc();
    if (!arc) return [s0, s1];
    const turned = Math.abs(arc.sweep) * (Math.abs(s1 - s0) / arc.length);
    const steps = Math.max(1, Math.ceil(turned / (Math.PI / 24)));
    return Array.from(
      { length: steps + 1 },
      (_, i) => s0 + ((s1 - s0) * i) / steps,
    );
  }

  getHeight(): number {
    return this.vertical.height;
  }

  /** assembly layers from the type catalog win over the local prop */
  getThickness(): number {
    if (this.typeRef && this.doc) {
      const def = this.doc.types.get(this.typeRef);
      if (def?.layers && def.layers.length > 0) {
        return def.layers.reduce((sum, layer) => sum + layer.thickness, 0);
      }
    }
    return this.thickness;
  }

  private normal(): Vector {
    return perpendicular(normalize(sub(this.b, this.a)));
  }

  /** the point and outward direction of one end, as the resolvers want it */
  private endDescriptor(which: WallEndSide): WallEnd {
    return {
      point: which === 'start' ? this.a : this.b,
      direction: this.endDirection(which),
      halfWidth: this.getThickness() / 2,
    };
  }

  /**
   * Which way the wall LEAVES one of its ends, pointing away from the junction
   * and into the wall.
   *
   * The tangent on a curve, not the chord. The miter is cut against the
   * direction the wall actually arrives from, and on a curved wall those are
   * different by half the sweep — enough that a corner cut to the chord would
   * visibly miss.
   */
  private endDirection(which: WallEndSide): Vector {
    const arc = this.arc();
    if (arc) {
      return which === 'start'
        ? arcTangentAt(arc, 0)
        : scale(arcTangentAt(arc, arc.length), -1);
    }
    const away = which === 'start' ? sub(this.b, this.a) : sub(this.a, this.b);
    return normalize(away);
  }

  /**
   * The walls this end is actually JOINED to — the single answer to "is this
   * end connected?", and the discovery the mitered corner itself runs on.
   *
   * Joins are derived, never stored (see docs/editor-core/04-systems/
   * wall-joins.md), so there is no join table to consult: coincident endpoints
   * are found through the spatial index, and only when there are none does a
   * lone end look for a wall body to tee into. Shared-endpoint neighbours
   * always win — the wheel beats the tee — and tees come back nearest-first,
   * so `[0]` is the host that would actually be butted against.
   *
   * An empty list means a free end. Proximity alone never counts: a wall
   * passing 5 cm away is not joined to anything.
   *
   * Two rules about WHICH walls count, both about the fact that a join is not
   * bookkeeping — it changes how the wall is drawn:
   *
   * - a hidden wall neither takes a join nor gives one. Mitering a corner to
   *   fit a wall the user cannot see is a corner cut to fit a ghost.
   * - a LOCKED wall joins only other locked walls. Locking is how the original
   *   survey is held still while new work is drawn over it, and a miter is
   *   mutual: without this rule, drawing a wall onto the plan would re-cut the
   *   plan's own corners. New work still joins the locked plan — that is what
   *   makes it meet cleanly — the influence simply runs one way.
   */
  getJoinsAt(which: WallEndSide): WallJoin[] {
    const doc = this.doc;
    if (!doc || this.getLength() < JOIN_TOLERANCE) return [];
    if (!isEntityVisible(doc, this)) return [];
    // both walls are visible by the time this is used, so "interactive" here
    // reads as "unlocked": editable work adapts to the plan, never the reverse
    const held = !isEntityInteractive(doc, this);
    const p = which === 'start' ? this.a : this.b;
    const nearby: WallEntity[] = [];
    for (const other of doc.queryBBox(
      bboxExpand(bboxFromPoints([p]), JOIN_TOLERANCE),
    )) {
      if (other === this || !(other instanceof WallEntity)) continue;
      if (!isEntityVisible(doc, other)) continue;
      if (held && isEntityInteractive(doc, other)) continue;
      const bl = other.getBaseline();
      if (distance(bl.a, bl.b) < JOIN_TOLERANCE) continue;
      nearby.push(other);
    }

    const corners = nearby.filter((other) => {
      const bl = other.getBaseline();
      return (
        distance(bl.a, p) <= JOIN_TOLERANCE ||
        distance(bl.b, p) <= JOIN_TOLERANCE
      );
    });
    if (corners.length > 0) {
      return corners.map((wall) => ({ wall, kind: 'corner' as const }));
    }

    const tees: { wall: WallEntity; dist: number }[] = [];
    for (const other of nearby) {
      const bl = other.getBaseline();
      const foot = closestPointOnSegment(p, bl.a, bl.b);
      const dist = distance(p, foot);
      if (dist > other.getThickness() / 2 + JOIN_TOLERANCE) continue;
      // near the host's endpoints this is an L/corner case, not a T
      if (
        distance(foot, bl.a) <= JOIN_TOLERANCE ||
        distance(foot, bl.b) <= JOIN_TOLERANCE
      ) {
        continue;
      }
      tees.push({ wall: other, dist });
    }
    tees.sort((x, y) => x.dist - y.dist);
    return tees.map((tee) => ({ wall: tee.wall, kind: 'tee' as const }));
  }

  /**
   * Auto-join: walls whose endpoints coincide (within JOIN_TOLERANCE) miter
   * their caps against each other. Derived on every read, never stored — a
   * join dissolves the moment a wall is dragged away.
   */
  private junctionCap(which: WallEndSide): EndCap | null {
    if (!this.doc || this.getLength() < JOIN_TOLERANCE) return null;
    const selfEnd = this.endDescriptor(which);
    const joins = this.getJoinsAt(which);
    if (joins.length === 0) return null;

    if (joins[0].kind === 'corner') {
      const ends: WallEnd[] = [selfEnd];
      for (const { wall } of joins) {
        const bl = wall.getBaseline();
        // direction points AWAY from the junction, into the neighbour — asked
        // of the neighbour so a curved one contributes its tangent, not its
        // chord
        const side: WallEndSide =
          distance(bl.a, selfEnd.point) <= JOIN_TOLERANCE ? 'start' : 'end';
        ends.push({
          point: selfEnd.point,
          direction: wall.endDirection(side),
          halfWidth: wall.getThickness() / 2,
        });
      }
      return resolveJunction(ends)[0];
    }
    return this.teeCap(selfEnd, joins);
  }

  /**
   * T-junction (joins V2): this end touches the BODY of another wall away
   * from its endpoints — butt against that wall's near face. The continuous
   * wall is untouched. Hosts arrive nearest-first; the first that can actually
   * produce a butt wins (a parallel face cannot).
   */
  private teeCap(selfEnd: WallEnd, joins: readonly WallJoin[]): EndCap | null {
    for (const { wall } of joins) {
      const bl = wall.getBaseline();
      const u = normalize(sub(bl.b, bl.a));
      const n = perpendicular(u);
      const halfB = wall.getThickness() / 2;
      // near face = the side of the host's centerline this wall extends toward
      const side = dot(selfEnd.direction, n) >= 0 ? 1 : -1;
      const cap = resolveTeeCap(selfEnd, add(bl.a, scale(n, side * halfB)), u);
      if (cap) return cap;
    }
    return null;
  }

  /**
   * A JOGGED end takes no cap.
   *
   * Stating a jog is stating what this corner does, so the miter steps aside
   * rather than fighting it: the two would otherwise both be trying to shape
   * the same two points, and the answer would depend on which ran last. It is
   * also the join opt-out the docs pair with per-corner overrides — the same
   * switch, seen from the geometry side.
   */
  private capsForEnds(): { start: EndCap | null; end: EndCap | null } {
    return {
      start: this.jogs.start === 0 ? this.junctionCap('start') : null,
      end: this.jogs.end === 0 ? this.junctionCap('end') : null,
    };
  }

  /**
   * The plan outline of the [s0, s1] stretch: junction caps, corner jogs and
   * curvature all at once.
   *
   * Built as two FACES walked along the centreline rather than as a quad with
   * corners poked into it. That is what lets three features share one path: a
   * cap replaces a face's end point, a jog trades that end point for the three
   * of a riser, and a curve simply puts more points in between. None of them
   * has to know about the others.
   *
   * A straight wall with no jog samples exactly its two ends and comes out as
   * the identical four-cornered quad it always was — ring order unchanged:
   * start+normal, end+normal, end−normal, start−normal.
   */
  private spanQuadJoined(
    s0: number,
    s1: number,
    caps: { start: EndCap | null; end: EndCap | null },
  ): Point[] {
    const half = this.getThickness() / 2;
    const atStart = s0 <= JOIN_TOLERANCE;
    const atEnd = s1 >= this.getLength() - JOIN_TOLERANCE;
    // a jog belongs to an END of the wall, so an interior span between two
    // openings is never stepped even though it shares the baseline
    const jogStart = atStart ? this.jogs.start : 0;
    const jogEnd = atEnd ? this.jogs.end : 0;

    /*
     * How far back from an end the wall steps across. Taken from the wall own
     * thickness rather than asked for: a step is a corner detail, it is always
     * about as deep as the wall is thick, and a second number to fill in for
     * every corner would be a form where a switch was wanted.
     *
     * Clamped to the span so a short one — an opening sitting near the end —
     * cannot fold the outline back through itself.
     */
    const step = Math.min(this.getThickness(), (s1 - s0) / 2);
    const innerStart = jogStart !== 0 ? s0 + step : s0;
    const innerEnd = jogEnd !== 0 ? s1 - step : s1;

    const off = (s: number, d: number) =>
      add(this.pointAt(s), scale(this.normalAt(s), d));

    const samples = this.samplesAcross(innerStart, innerEnd);
    const face = (d: number) => samples.map((s) => off(s, d));
    let plus = face(half);
    let minus = face(-half);

    // Caps only ever land on an UNJOGGED end — capsForEnds already returns
    // null for a jogged one, so the two can never fight over the same point.
    if (caps.start && atStart) {
      plus[0] = caps.start.left;
      minus[0] = caps.start.right;
    }
    if (caps.end && atEnd) {
      plus[plus.length - 1] = caps.end.right;
      minus[minus.length - 1] = caps.end.left;
    }

    // a stepped face trades its one square corner for the three of a riser
    if (jogStart !== 0) {
      plus = [
        off(s0, half + jogStart),
        off(innerStart, half + jogStart),
        ...plus,
      ];
      minus = [
        off(s0, -half + jogStart),
        off(innerStart, -half + jogStart),
        ...minus,
      ];
    }
    if (jogEnd !== 0) {
      plus = [...plus, off(innerEnd, half + jogEnd), off(s1, half + jogEnd)];
      minus = [
        ...minus,
        off(innerEnd, -half + jogEnd),
        off(s1, -half + jogEnd),
      ];
    }

    return [...plus, ...minus.reverse()];
  }

  private spanRegion(s0: number, s1: number): RegionShape {
    return {
      kind: 'region',
      boundary: this.spanQuadJoined(s0, s1, { start: null, end: null }),
      holes: [],
    };
  }

  getOpeningSpecs(): OpeningSpec[] {
    if (!this.doc) return [];
    const specs: OpeningSpec[] = [];
    for (const relation of this.doc.relations.relationsOfHost(this.id)) {
      const hosted = this.doc.get(relation.hostedId);
      if (hosted && cutsOpening(hosted)) specs.push(hosted.getOpeningSpec());
    }
    return specs;
  }

  /** solid stretches of the baseline once openings are subtracted */
  getSolidSpans(): Interval[] {
    const len = this.getLength();
    const cuts = this.getOpeningSpecs().map((spec) => {
      const center = spec.t * len;
      return { start: center - spec.width / 2, end: center + spec.width / 2 };
    });
    return subtractIntervals(len, cuts);
  }

  getBaseGeometry(): Geometry {
    return this.spanRegion(0, this.getLength());
  }

  /**
   * The wall's plan outline end to end, join caps included and openings
   * ignored — the extent a reader sees as "the wall".
   *
   * Neither existing accessor answers that: getBaseGeometry() is the un-capped
   * rectangle (so it stops at the baseline endpoints, short of a mitered
   * corner), and getEffectiveGeometry() is split into solid spans, so an
   * opening reaching an end would shorten it.
   */
  getOutline(): Point[] {
    return this.spanQuadJoined(0, this.getLength(), this.capsForEnds());
  }

  /**
   * Bounds always include the baseline. Join caps can clip the effective
   * body AWAY from a baseline endpoint (a tee stops at the host's face), and
   * junction discovery queries the spatial index by endpoint — bounds must
   * therefore stay cap-independent around endpoints or joins would depend on
   * their own output.
   */
  override getBounds(): BBox {
    return bboxUnion(super.getBounds(), bboxFromPoints([this.a, this.b]));
  }

  override getEffectiveGeometry(): Geometry {
    if (!this.doc) return this.getBaseGeometry();
    const spans = this.getSolidSpans();
    if (spans.length === 0) {
      // fully consumed by openings — keep the baseline so bounds stay sane
      return { kind: 'segment', a: this.a, b: this.b };
    }
    const caps = this.capsForEnds();
    const regions: RegionShape[] = spans.map((s) => ({
      kind: 'region',
      boundary: this.spanQuadJoined(s.start, s.end, caps),
      holes: [],
    }));
    if (
      regions.length === 1 &&
      spans[0].start === 0 &&
      spans[0].end === this.getLength()
    ) {
      return regions[0];
    }
    return { kind: 'group', children: regions };
  }

  /**
   * Where things attach: the centreline and the two faces.
   *
   * A curved wall offers the same three as polylines along the curve rather
   * than segments across the chord, so anything that measures to a face or
   * rides the axis follows the wall instead of cutting the corner.
   */
  getAnchors(): Anchor[] {
    const half = this.getThickness() / 2;
    const arc = this.arc();
    if (!arc) {
      const off = scale(this.normal(), half);
      return [
        {
          kind: 'curve',
          geometry: { kind: 'segment', a: this.a, b: this.b },
          name: 'axis',
        },
        {
          kind: 'face',
          geometry: {
            kind: 'segment',
            a: add(this.a, off),
            b: add(this.b, off),
          },
          name: 'face+',
        },
        {
          kind: 'face',
          geometry: {
            kind: 'segment',
            a: sub(this.a, off),
            b: sub(this.b, off),
          },
          name: 'face-',
        },
      ];
    }
    const samples = this.samplesAcross(0, arc.length);
    const along = (d: number) =>
      samples.map((s) => add(this.pointAt(s), scale(this.normalAt(s), d)));
    return [
      {
        kind: 'curve',
        geometry: { kind: 'polyline', points: along(0), closed: false },
        name: 'axis',
      },
      {
        kind: 'face',
        geometry: { kind: 'polyline', points: along(half), closed: false },
        name: 'face+',
      },
      {
        kind: 'face',
        geometry: { kind: 'polyline', points: along(-half), closed: false },
        name: 'face-',
      },
    ];
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean =>
      !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    if (wanted('endpoint')) {
      result.push({ kind: 'endpoint', point: this.a, entityId: this.id });
      result.push({ kind: 'endpoint', point: this.b, entityId: this.id });
    }
    if (wanted('midpoint')) {
      // the middle OF THE WALL, which on a curve is the apex and not the
      // middle of the chord — snapping to a point the wall does not pass
      // through would be worse than not offering it
      const arc = this.arc();
      result.push({
        kind: 'midpoint',
        point: arc ? arcPointAt(arc, arc.length / 2) : midpoint(this.a, this.b),
        entityId: this.id,
      });
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    const reach = this.getThickness() / 2 + tolerance;
    const arc = this.arc();
    if (!arc) return distanceToSegment(pt, this.a, this.b) <= reach;
    // measured against the curve, so the inside of a bend is not tappable and
    // the wall itself is — the chord would have both backwards
    return (
      distanceToPolyline(pt, tessellateArc(arc, 0, arc.length), false) <= reach
    );
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (wall) => {
      wall.setBaseline(applyToPoint(m, wall.a), applyToPoint(m, wall.b));
    });
  }

  /**
   * The two ends, plus — on a curved wall — the APEX.
   *
   * The apex rather than the centre, because the centre of a gentle curve is
   * hundreds of meters off the plan and cannot be dragged at all. The apex is
   * on the wall, under the finger, and moves the way the wall moves.
   *
   * Only when curved: a straight wall showing a bend handle would be a third
   * thing to hit on a phone where the two endpoints are already close
   * together.
   */
  getGrips(): GripPoint[] {
    const grips: GripPoint[] = [
      { index: 0, point: this.a, kind: 'endpoint' },
      { index: 1, point: this.b, kind: 'endpoint' },
    ];
    const arc = this.arc();
    if (arc) {
      grips.push({
        index: 2,
        point: arcPointAt(arc, arc.length / 2),
        kind: 'midpoint',
      });
      // the CENTRE the wall turns about. Off the plan entirely on a gentle
      // curve, which is why it is the second handle and not the first — but on
      // a tight one it is right there, and setting the radius by its centre is
      // how a curve is drawn on paper.
      grips.push({ index: 3, point: arc.center, kind: 'center' });
    }
    return grips;
  }

  /** stretch the baseline — hosted openings keep their parametric t and follow */
  /**
   * Indexes 2 and 3 BEND rather than move. Neither the apex nor the centre is a
   * point the wall stores — both are produced by the sweep — so dragging either
   * works backwards to the sweep that would put it under the finger.
   *
   * They are two ways to say the same thing and they meet in the middle: the
   * apex is direct and always reachable, the centre sets the radius the way a
   * curve is struck on paper. The centre can only travel the perpendicular
   * bisector, since that is the only line a circle through both endpoints can
   * have its centre on.
   */
  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (wall) => {
      if (index === 0) wall.a = to;
      else if (index === 1) wall.b = to;
      else if (index === 2) wall.sweep = sweepFromApex(wall.a, wall.b, to);
      else if (index === 3) {
        wall.sweep = sweepFromCenter(wall.a, wall.b, to, wall.sweep);
      }
    });
  }

  clone(): WallEntity {
    const copy = new WallEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setBaseline(this.a, this.b);
    copy.thickness = this.thickness;
    copy.baseLevelId = this.baseLevelId;
    copy.vertical = { height: this.vertical.height };
    copy.jogs = { ...this.jogs };
    copy.sweep = this.sweep;
    return copy;
  }

  toMesh(_detail: MeshDetail): Mesh3D {
    const z0 = this.baseElevation();
    const height = this.getHeight();
    const len = this.getLength();
    const caps = this.capsForEnds();
    const meshes: Mesh3D[] = [];
    for (const span of this.getSolidSpans()) {
      const ring = this.spanQuadJoined(span.start, span.end, caps);
      // the quad path stays the common one; only a stepped end needs the
      // general lofter, and it is the same prism either way
      meshes.push(
        ring.length === 4
          ? extrudeQuad(ring as [Point, Point, Point, Point], z0, z0 + height)
          : extrudePolygon(ring, z0, z0 + height),
      );
    }
    // opening sill/lintel bands keep square ends — a band flush against a
    // mitered corner is a known V1 limitation (see docs wall-joins.md)
    for (const spec of this.getOpeningSpecs()) {
      const center = spec.t * len;
      const s0 = Math.max(0, center - spec.width / 2);
      const s1 = Math.min(len, center + spec.width / 2);
      if (s1 - s0 <= 0) continue;
      // the band under and over an opening curves with the wall it is cut
      // into, so it is the same band the solid spans use
      const band = this.spanQuadJoined(s0, s1, { start: null, end: null });
      if (spec.sill > 0) {
        meshes.push(extrudePolygon(band, z0, z0 + Math.min(spec.sill, height)));
      }
      const head = spec.sill + spec.height;
      if (head < height) {
        meshes.push(extrudePolygon(band, z0 + head, z0 + height));
      }
    }
    return mergeMeshes(meshes);
  }

  baseElevation(): number {
    if (this.baseLevelId && this.doc) {
      return this.doc.levels.get(this.baseLevelId)?.elevation ?? 0;
    }
    return 0;
  }

  protected saveProps(): JsonObject {
    return {
      ax: this.a.x,
      ay: this.a.y,
      bx: this.b.x,
      by: this.b.y,
      thickness: this.thickness,
      height: this.vertical.height,
      baseLevelId: this.baseLevelId,
      // written only when there is one, so every wall drawn before jogs
      // existed saves byte-for-byte as it did
      ...(this.jogs.start !== 0 ? { jogStart: this.jogs.start } : {}),
      ...(this.jogs.end !== 0 ? { jogEnd: this.jogs.end } : {}),
      ...(this.sweep !== 0 ? { sweep: this.sweep } : {}),
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { ax, ay, bx, by, thickness, height } = props;
    if (
      typeof ax !== 'number' ||
      typeof ay !== 'number' ||
      typeof bx !== 'number' ||
      typeof by !== 'number' ||
      typeof thickness !== 'number' ||
      typeof height !== 'number'
    ) {
      throw new ValidationError(`wall ${this.id}: invalid props`);
    }
    this.a = point(ax, ay);
    this.b = point(bx, by);
    this.thickness = thickness;
    this.vertical = { height };
    this.baseLevelId =
      typeof props['baseLevelId'] === 'string'
        ? (props['baseLevelId'] as LevelId)
        : null;
    // absent means no jog, which is what every file written before this
    // existed says by saying nothing
    this.jogs = {
      start: typeof props['jogStart'] === 'number' ? props['jogStart'] : 0,
      end: typeof props['jogEnd'] === 'number' ? props['jogEnd'] : 0,
    };
    this.sweep =
      typeof props['sweep'] === 'number' ? clampSweep(props['sweep']) : 0;
  }
}

export function createWallEntity(id?: EntityId): WallEntity {
  return new WallEntity(id);
}
