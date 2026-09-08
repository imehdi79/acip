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

  getLength(): number {
    return distance(this.a, this.b);
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

  /** plan rectangle for the [s0, s1] stretch (in meters along the baseline) */
  private spanQuad(s0: number, s1: number): [Point, Point, Point, Point] {
    const len = this.getLength();
    const pa = len === 0 ? this.a : lerp(this.a, this.b, s0 / len);
    const pb = len === 0 ? this.b : lerp(this.a, this.b, s1 / len);
    const half = scale(this.normal(), this.getThickness() / 2);
    return [add(pa, half), add(pb, half), sub(pb, half), sub(pa, half)];
  }

  /** the point and outward direction of one end, as the resolvers want it */
  private endDescriptor(which: WallEndSide): WallEnd {
    const p = which === 'start' ? this.a : this.b;
    const away = which === 'start' ? sub(this.b, this.a) : sub(this.a, this.b);
    return {
      point: p,
      direction: normalize(away),
      halfWidth: this.getThickness() / 2,
    };
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
        // direction points AWAY from the junction, into the neighbour
        const dir =
          distance(bl.a, selfEnd.point) <= JOIN_TOLERANCE
            ? normalize(sub(bl.b, bl.a))
            : normalize(sub(bl.a, bl.b));
        ends.push({
          point: selfEnd.point,
          direction: dir,
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
   * Span outline with junction caps swapped in at terminal spans. The start cap
   * maps left→+normal directly; the end cap's direction points backwards, so
   * its left/right land on the −/+ normal corners.
   *
   * Four points for the ordinary wall, which is every wall that has not been
   * given a jog. A jogged end adds the two corners of its step, so the ring
   * grows to six, or eight when both ends step. Returning a list rather than a
   * fixed quad is the whole cost of jogs in this file — everything downstream
   * already walks the boundary rather than indexing it.
   *
   * Ring order is unchanged and is what the step points slot into:
   * start+normal, end+normal, end−normal, start−normal.
   */
  private spanQuadJoined(
    s0: number,
    s1: number,
    caps: { start: EndCap | null; end: EndCap | null },
  ): Point[] {
    const quad = this.spanQuad(s0, s1);
    const atStart = s0 <= JOIN_TOLERANCE;
    const atEnd = s1 >= this.getLength() - JOIN_TOLERANCE;
    if (caps.start && atStart) {
      quad[0] = caps.start.left;
      quad[3] = caps.start.right;
    }
    if (caps.end && atEnd) {
      quad[1] = caps.end.right;
      quad[2] = caps.end.left;
    }

    // a jog belongs to an END of the wall, so an interior span between two
    // openings is never stepped even though it shares the baseline
    const jogStart = atStart ? this.jogs.start : 0;
    const jogEnd = atEnd ? this.jogs.end : 0;
    if (jogStart === 0 && jogEnd === 0) return quad;

    const len = this.getLength();
    const half = this.getThickness() / 2;
    const n = this.normal();
    const on = (s: number) => lerp(this.a, this.b, s / len);
    const off = (p: Point, d: number) => add(p, scale(n, d));

    /*
     * How far back from the end the wall steps across. Taken from the wall's
     * own thickness rather than asked for: a step is a corner detail, it is
     * always about as deep as the wall is thick, and a second number to fill
     * in for every corner would be a form where a switch was wanted.
     *
     * Clamped to the span so a short one — an opening sitting near the end —
     * cannot fold the outline back through itself.
     */
    const step = Math.min(this.getThickness(), (s1 - s0) / 2);

    const qStart = on(s0 + step);
    const qEnd = on(s1 - step);

    // each face is walked in ring order, and a stepped end contributes its
    // riser as two extra points instead of the single square corner
    return [
      ...(jogStart !== 0
        ? [
            off(on(s0), half + jogStart),
            off(qStart, half + jogStart),
            off(qStart, half),
          ]
        : [quad[0]]),
      ...(jogEnd !== 0
        ? [
            off(qEnd, half),
            off(qEnd, half + jogEnd),
            off(on(s1), half + jogEnd),
          ]
        : [quad[1]]),
      ...(jogEnd !== 0
        ? [
            off(on(s1), -half + jogEnd),
            off(qEnd, -half + jogEnd),
            off(qEnd, -half),
          ]
        : [quad[2]]),
      ...(jogStart !== 0
        ? [
            off(qStart, -half),
            off(qStart, -half + jogStart),
            off(on(s0), -half + jogStart),
          ]
        : [quad[3]]),
    ];
  }

  private spanRegion(s0: number, s1: number): RegionShape {
    return { kind: 'region', boundary: this.spanQuad(s0, s1), holes: [] };
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

  getAnchors(): Anchor[] {
    const half = scale(this.normal(), this.getThickness() / 2);
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
          a: add(this.a, half),
          b: add(this.b, half),
        },
        name: 'face+',
      },
      {
        kind: 'face',
        geometry: {
          kind: 'segment',
          a: sub(this.a, half),
          b: sub(this.b, half),
        },
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
      result.push({
        kind: 'midpoint',
        point: midpoint(this.a, this.b),
        entityId: this.id,
      });
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    return (
      distanceToSegment(pt, this.a, this.b) <=
      this.getThickness() / 2 + tolerance
    );
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (wall) => {
      wall.setBaseline(applyToPoint(m, wall.a), applyToPoint(m, wall.b));
    });
  }

  getGrips(): GripPoint[] {
    return [
      { index: 0, point: this.a, kind: 'endpoint' },
      { index: 1, point: this.b, kind: 'endpoint' },
    ];
  }

  /** stretch the baseline — hosted openings keep their parametric t and follow */
  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (wall) => {
      if (index === 0) wall.a = to;
      else wall.b = to;
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
      const quad = this.spanQuad(s0, s1);
      if (spec.sill > 0) {
        meshes.push(extrudeQuad(quad, z0, z0 + Math.min(spec.sill, height)));
      }
      const head = spec.sill + spec.height;
      if (head < height) {
        meshes.push(extrudeQuad(quad, z0 + head, z0 + height));
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
  }
}

export function createWallEntity(id?: EntityId): WallEntity {
  return new WallEntity(id);
}
