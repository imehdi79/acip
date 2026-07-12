import { Entity } from '../base/entity.js';
import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { distance, point } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint, applyToVector } from '../../geometry/primitives/matrix3.js';
import { length } from '../../geometry/primitives/point.js';
import { distanceToCircle, pointOnCircle } from '../../geometry/curves/circle.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { GripPoint, IGrippable } from '../base/capabilities.js';
import type { Transaction } from '../../document/history/transaction.js';

export class CircleEntity extends Entity implements IGrippable {
  static readonly TYPE = 'circle';

  readonly type: string = CircleEntity.TYPE;

  private center: Point = point(0, 0);
  radius = 1;

  getCenter(): Point {
    return this.center;
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setCenter(center: Point): void {
    this.center = center;
  }

  getBaseGeometry(): Geometry {
    return { kind: 'circle', center: this.center, radius: this.radius };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean => !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    if (wanted('center')) {
      result.push({ kind: 'center', point: this.center, entityId: this.id });
    }
    if (wanted('quadrant')) {
      for (let q = 0; q < 4; q++) {
        result.push({
          kind: 'quadrant',
          point: pointOnCircle(this.center, this.radius, (q * Math.PI) / 2),
          entityId: this.id,
        });
      }
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    return distanceToCircle(pt, this.center, this.radius) <= tolerance;
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (e) => {
      e.center = applyToPoint(m, e.center);
      e.radius *= length(applyToVector(m, { x: 1, y: 0 }));
    });
  }

  /** grip 0 = center (move); grips 1-4 = quadrants (resize radius) */
  getGrips(): GripPoint[] {
    const grips: GripPoint[] = [{ index: 0, point: this.center, kind: 'center' }];
    for (let q = 0; q < 4; q++) {
      grips.push({
        index: q + 1,
        point: pointOnCircle(this.center, this.radius, (q * Math.PI) / 2),
        kind: 'quadrant',
      });
    }
    return grips;
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (e) => {
      if (index === 0) e.center = to;
      else e.radius = Math.max(1e-9, distance(e.center, to));
    });
  }

  clone(): CircleEntity {
    const copy = new CircleEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setCenter(this.center);
    copy.radius = this.radius;
    return copy;
  }

  protected saveProps(): JsonObject {
    return { cx: this.center.x, cy: this.center.y, radius: this.radius };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { cx, cy, radius } = props;
    if (typeof cx !== 'number' || typeof cy !== 'number' || typeof radius !== 'number') {
      throw new ValidationError(`circle ${this.id}: invalid props`);
    }
    this.center = point(cx, cy);
    this.radius = radius;
  }
}

export function createCircleEntity(id?: EntityId): CircleEntity {
  return new CircleEntity(id);
}
