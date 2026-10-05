import { Entity } from '../base/entity.js';
import type { RelationId } from '../../common/id.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  angleOf,
  dot,
  perpendicular,
  point,
  scale,
  sub,
} from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import {
  closestParamOnPolyline,
  polylineFrameAt,
  polylineLength,
} from '../../geometry/curves/polyline.js';
import type {
  Anchor,
  GripPoint,
  IGrippable,
  IHosted,
  IOpeningCutter,
  OpeningSpec,
  Placement,
  PlacementParams,
} from '../base/capabilities.js';
import { isHost } from '../base/capabilities.js';
import type { Phase } from './phase.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

interface HasThickness {
  getThickness(): number;
}

export interface OpeningFrame {
  center: Point;
  u: Vector;
  n: Vector;
  halfWidth: number;
  halfThickness: number;
}

/** where an end-grip drag lands, in host-parametric AND world terms */
export interface OpeningSpan {
  /** normalized position of the opening center along the host axis */
  readonly t: number;
  /** opening width in meters */
  readonly width: number;
  /** the span's two ends on the host axis, so a tool can preview it */
  readonly a: Point;
  readonly b: Point;
}

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

/**
 * Shared machinery for entities hosted on a wall axis that cut an opening
 * (windows, doors). No absolute position is ever stored: placement derives
 * from (host anchor, t). Implementation note: t lives in the entity's own
 * props (single update path); the relation stores the anchor index.
 */
export abstract class HostedOpeningEntity
  extends Entity
  implements IHosted, IOpeningCutter, IGrippable
{
  /**
   * Narrowest opening a drag may produce. A zero-width window is not a thing
   * a plan can hold, and a resize that collapses to nothing reads as a
   * mis-touch rather than an intent.
   */
  static readonly MIN_WIDTH = 0.3;

  /** frame depth through the wall, in meters */
  static readonly DEFAULT_THICKNESS = 0.05;

  /** normalized position of the opening center along the host axis */
  t = 0.5;
  width = 1.0;
  height = 1.2;
  /**
   * Frame depth through the wall.
   *
   * NOTHING reads this yet. The plan symbol and the hit test take their depth
   * from the host wall's thickness, and the 3D pane is a fixed thin sheet — a
   * frame with its own depth is 3D work that does not exist. It is stored
   * anyway because it is a number the user measures off a real window, and a
   * drawing saved today cannot be given one retroactively.
   */
  thickness = HostedOpeningEntity.DEFAULT_THICKNESS;
  /** `new` = install; `demolish` = existing opening to be removed (renovation) */
  phase: Phase = 'new';

  /** bottom of the opening above the host's base (0 for doors) */
  abstract getSillHeight(): number;

  get hostRef(): RelationId | null {
    return this.doc?.relations.relationOfHosted(this.id)?.id ?? null;
  }

  protected host(): Entity | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    if (!relation) return null;
    return this.doc.get(relation.hostId);
  }

  protected axisAnchor(): Anchor | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    const host = this.host();
    if (!relation || !host || !isHost(host)) return null;
    const anchors = host.getAnchors();
    const anchor =
      anchors[relation.anchorIndex] ?? anchors.find((a) => a.kind === 'curve');
    if (!anchor) return null;
    const kind = anchor.geometry.kind;
    return kind === 'segment' || kind === 'polyline' ? anchor : null;
  }

  /**
   * The host axis as a run of points: two for a straight host, more for one
   * that curves.
   *
   * Everything below is written against this rather than against a segment,
   * because `t` was never a position along a straight line — it is a fraction
   * of the DISTANCE along the host, and that reading is what carries an
   * opening around a wall that bows without the opening being told. A host
   * that hands back a two-point axis gets exactly the segment arithmetic it
   * always got.
   */
  protected axisPoints(): Point[] | null {
    const anchor = this.axisAnchor();
    if (!anchor) return null;
    const g = anchor.geometry;
    if (g.kind === 'segment') return [g.a, g.b];
    return g.kind === 'polyline' && g.points.length >= 2 ? [...g.points] : null;
  }

  protected frame(): OpeningFrame | null {
    const axis = this.axisPoints();
    const host = this.host();
    if (!axis || !host) return null;
    const at = polylineFrameAt(axis, this.t);
    if (!at) return null;
    const thickness =
      typeof (host as Partial<HasThickness>).getThickness === 'function'
        ? (host as unknown as HasThickness).getThickness()
        : 0.2;
    return {
      center: at.point,
      u: at.tangent,
      n: perpendicular(at.tangent),
      halfWidth: this.width / 2,
      halfThickness: thickness / 2,
    };
  }

  /** base elevation of the host's level, for 3D derivation */
  protected hostElevation(): number {
    const host = this.host();
    if (!host || !this.doc) return 0;
    const levelId = (host as Partial<{ baseLevelId: unknown }>).baseLevelId;
    if (typeof levelId !== 'string') return 0;
    return this.doc.levels.get(levelId as never)?.elevation ?? 0;
  }

  evalPlacement(anchor: Anchor, _params: PlacementParams): Placement {
    const g = anchor.geometry;
    const axis =
      g.kind === 'segment'
        ? [g.a, g.b]
        : g.kind === 'polyline'
          ? g.points
          : null;
    const at = axis ? polylineFrameAt(axis, this.t) : null;
    // an axis with nothing to walk along places nothing; the caller reads a
    // placement, so answer with one rather than throwing at draw time
    if (!at) return { position: point(0, 0), rotation: 0 };
    return { position: at.point, rotation: angleOf(at.tangent) };
  }

  getOpeningSpec(): OpeningSpec {
    return {
      t: this.t,
      width: this.width,
      sill: this.getSillHeight(),
      height: this.height,
    };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const frame = this.frame();
    if (!frame) return [];
    const wanted = (kind: SnapKind): boolean =>
      !filter || filter.includes(kind);
    const du = scale(frame.u, frame.halfWidth);
    const result: SnapPoint[] = [];
    if (wanted('node')) {
      result.push({ kind: 'node', point: frame.center, entityId: this.id });
    }
    if (wanted('endpoint')) {
      result.push({
        kind: 'endpoint',
        point: sub(frame.center, du),
        entityId: this.id,
      });
      result.push({
        kind: 'endpoint',
        point: add(frame.center, du),
        entityId: this.id,
      });
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    const frame = this.frame();
    if (!frame) return false;
    const d = sub(pt, frame.center);
    return (
      Math.abs(dot(d, frame.u)) <= frame.halfWidth + tolerance &&
      Math.abs(dot(d, frame.n)) <= frame.halfThickness + tolerance
    );
  }

  /** project a target point back onto the host axis and update t */
  protected setPositionFromPoint(target: Point, tx: Transaction): void {
    const axis = this.axisPoints();
    if (!axis) return;
    const nextT = clamp01(closestParamOnPolyline(target, axis));
    tx.update(this, (entity) => {
      (entity as HostedOpeningEntity).t = nextT;
    });
  }

  /** hosted openings move ALONG their wall: the transform projects onto the axis */
  transform(m: Matrix3, tx: Transaction): void {
    const frame = this.frame();
    if (!frame) return;
    this.setPositionFromPoint(applyToPoint(m, frame.center), tx);
  }

  /**
   * Where an end-grip drag lands: the OTHER end stays put, so the opening
   * grows and shrinks from the side under the finger, and the result always
   * fits inside the host. Pure, so a tool previews exactly what will commit.
   */
  planEndDrag(index: number, to: Point): OpeningSpan | null {
    const axis = this.axisPoints();
    if (!axis) return null;
    const len = polylineLength(axis);
    if (len === 0) return null;
    const on = (along: number): Point =>
      polylineFrameAt(axis, along / len)?.point ?? axis[0];
    // meters along the axis: grip 1 is the low end, so grip 2's is the one to
    // leave alone, and the other way round
    const center = this.t * len;
    const fixed =
      index === 1 ? center + this.width / 2 : center - this.width / 2;
    const dragged = clamp(closestParamOnPolyline(to, axis) * len, 0, len);
    const width = clamp(
      Math.abs(dragged - fixed),
      Math.min(HostedOpeningEntity.MIN_WIDTH, len),
      len,
    );
    const half = width / 2;
    // which side of the fixed end the opening lies on. Dragging PAST it flips
    // the opening over, the way a stretch through zero behaves everywhere;
    // dragging exactly onto it leaves the side alone
    const side = index === 1 ? -1 : 1;
    const dir = (dragged - fixed) * side >= 0 ? side : -side;
    const at = clamp(fixed + dir * half, half, len - half);
    return {
      t: at / len,
      width,
      a: on(at - half),
      b: on(at + half),
    };
  }

  getGrips(): GripPoint[] {
    const frame = this.frame();
    if (!frame) return [];
    const du = scale(frame.u, frame.halfWidth);
    return [
      { index: 0, point: frame.center, kind: 'position' },
      { index: 1, point: sub(frame.center, du), kind: 'endpoint' },
      { index: 2, point: add(frame.center, du), kind: 'endpoint' },
    ];
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    if (index === 0) {
      this.setPositionFromPoint(to, tx);
      return;
    }
    const span = this.planEndDrag(index, to);
    if (!span) return;
    tx.update(this, (entity) => {
      const opening = entity as HostedOpeningEntity;
      opening.t = span.t;
      opening.width = span.width;
    });
  }
}

/**
 * Frame depth off saved props. Every drawing written before the field existed
 * has none, and that is not a corrupt file — it falls back to the default
 * rather than refusing to open.
 */
export function asOpeningThickness(value: unknown): number {
  return typeof value === 'number' && value > 0
    ? value
    : HostedOpeningEntity.DEFAULT_THICKNESS;
}
