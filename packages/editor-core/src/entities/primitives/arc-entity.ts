import { Entity } from '../base/entity.js';
import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import {
  angleOf,
  distance,
  point,
  sub,
} from '../../geometry/primitives/point.js';
import { length } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import {
  applyToPoint,
  applyToVector,
} from '../../geometry/primitives/matrix3.js';
import { distanceToArc, pointOnCircle } from '../../geometry/curves/circle.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { GripPoint, IGrippable } from '../base/capabilities.js';
import type { Transaction } from '../../document/history/transaction.js';

const TWO_PI = Math.PI * 2;

/** circular arc sweeping CCW from startAngle to endAngle */
export class ArcEntity extends Entity implements IGrippable {
  static readonly TYPE = 'arc';

  readonly type: string = ArcEntity.TYPE;

  private center: Point = point(0, 0);
  radius = 1;
  startAngle = 0;
  endAngle = Math.PI / 2;

  getCenter(): Point {
    return this.center;
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setCenter(center: Point): void {
    this.center = center;
  }

  getStartPoint(): Point {
    return pointOnCircle(this.center, this.radius, this.startAngle);
  }

  getEndPoint(): Point {
    return pointOnCircle(this.center, this.radius, this.endAngle);
  }

  getMidPoint(): Point {
    const sweep =
      (((this.endAngle - this.startAngle) % TWO_PI) + TWO_PI) % TWO_PI;
    return pointOnCircle(this.center, this.radius, this.startAngle + sweep / 2);
  }

  getBaseGeometry(): Geometry {
    return {
      kind: 'arc',
      center: this.center,
      radius: this.radius,
      startAngle: this.startAngle,
      endAngle: this.endAngle,
    };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean =>
      !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    if (wanted('endpoint')) {
      result.push({
        kind: 'endpoint',
        point: this.getStartPoint(),
        entityId: this.id,
      });
      result.push({
        kind: 'endpoint',
        point: this.getEndPoint(),
        entityId: this.id,
      });
    }
    if (wanted('midpoint')) {
      result.push({
        kind: 'midpoint',
        point: this.getMidPoint(),
        entityId: this.id,
      });
    }
    if (wanted('center')) {
      result.push({ kind: 'center', point: this.center, entityId: this.id });
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    return (
      distanceToArc(
        pt,
        this.center,
        this.radius,
        this.startAngle,
        this.endAngle,
      ) <= tolerance
    );
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (e) => {
      const rotation = angleOf(applyToVector(m, { x: 1, y: 0 }));
      e.center = applyToPoint(m, e.center);
      e.radius *= length(applyToVector(m, { x: 1, y: 0 }));
      e.startAngle += rotation;
      e.endAngle += rotation;
    });
  }

  /** grip 0 = center (move); 1 = start point; 2 = end point (angle + radius) */
  getGrips(): GripPoint[] {
    return [
      { index: 0, point: this.center, kind: 'center' },
      { index: 1, point: this.getStartPoint(), kind: 'endpoint' },
      { index: 2, point: this.getEndPoint(), kind: 'endpoint' },
    ];
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (e) => {
      if (index === 0) {
        e.center = to;
        return;
      }
      const v = sub(to, e.center);
      const r = distance(e.center, to);
      if (r > 1e-9) e.radius = r;
      if (index === 1) e.startAngle = angleOf(v);
      else e.endAngle = angleOf(v);
    });
  }

  clone(): ArcEntity {
    const copy = new ArcEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setCenter(this.center);
    copy.radius = this.radius;
    copy.startAngle = this.startAngle;
    copy.endAngle = this.endAngle;
    return copy;
  }

  protected saveProps(): JsonObject {
    return {
      cx: this.center.x,
      cy: this.center.y,
      radius: this.radius,
      startAngle: this.startAngle,
      endAngle: this.endAngle,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { cx, cy, radius, startAngle, endAngle } = props;
    if (
      typeof cx !== 'number' ||
      typeof cy !== 'number' ||
      typeof radius !== 'number' ||
      typeof startAngle !== 'number' ||
      typeof endAngle !== 'number'
    ) {
      throw new ValidationError(`arc ${this.id}: invalid props`);
    }
    this.center = point(cx, cy);
    this.radius = radius;
    this.startAngle = startAngle;
    this.endAngle = endAngle;
  }
}

export function createArcEntity(id?: EntityId): ArcEntity {
  return new ArcEntity(id);
}
