import { Entity } from '../base/entity.js';
import type { RelationId } from '../../common/id.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  angleOf,
  dot,
  lerp,
  normalize,
  perpendicular,
  scale,
  sub,
} from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import type { SegmentShape } from '../../geometry/shapes.js';
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

export const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

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
  /** normalized position of the opening center along the host axis */
  t = 0.5;
  width = 1.0;
  height = 1.2;

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
    return anchor && anchor.geometry.kind === 'segment' ? anchor : null;
  }

  protected frame(): OpeningFrame | null {
    const anchor = this.axisAnchor();
    const host = this.host();
    if (!anchor || !host) return null;
    const seg = anchor.geometry as SegmentShape;
    const u = normalize(sub(seg.b, seg.a));
    const thickness =
      typeof (host as Partial<HasThickness>).getThickness === 'function'
        ? (host as unknown as HasThickness).getThickness()
        : 0.2;
    return {
      center: lerp(seg.a, seg.b, this.t),
      u,
      n: perpendicular(u),
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
    const seg = anchor.geometry as SegmentShape;
    return {
      position: lerp(seg.a, seg.b, this.t),
      rotation: angleOf(sub(seg.b, seg.a)),
    };
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
    const anchor = this.axisAnchor();
    if (!anchor) return;
    const seg = anchor.geometry as SegmentShape;
    const ab = sub(seg.b, seg.a);
    const lenSq = dot(ab, ab);
    const nextT =
      lenSq === 0 ? this.t : clamp01(dot(sub(target, seg.a), ab) / lenSq);
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

  getGrips(): GripPoint[] {
    const frame = this.frame();
    if (!frame) return [];
    return [{ index: 0, point: frame.center, kind: 'position' }];
  }

  moveGrip(_index: number, to: Point, tx: Transaction): void {
    this.setPositionFromPoint(to, tx);
  }
}
