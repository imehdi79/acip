import { Entity } from '../base/entity.js';
import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { midpoint, point } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import { distanceToPolyline } from '../../geometry/curves/polyline.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { GripPoint, IGrippable } from '../base/capabilities.js';
import type { Transaction } from '../../document/history/transaction.js';

export class PolylineEntity extends Entity implements IGrippable {
  static readonly TYPE = 'polyline';

  readonly type: string = PolylineEntity.TYPE;

  private points: Point[] = [];
  closed = false;

  getPoints(): readonly Point[] {
    return this.points;
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setPoints(points: readonly Point[]): void {
    this.points = [...points];
  }

  getBaseGeometry(): Geometry {
    return { kind: 'polyline', points: this.points, closed: this.closed };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean =>
      !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    if (wanted('endpoint')) {
      for (const p of this.points) {
        result.push({ kind: 'endpoint', point: p, entityId: this.id });
      }
    }
    if (wanted('midpoint')) {
      for (let i = 1; i < this.points.length; i++) {
        result.push({
          kind: 'midpoint',
          point: midpoint(this.points[i - 1], this.points[i]),
          entityId: this.id,
        });
      }
      if (this.closed && this.points.length > 2) {
        result.push({
          kind: 'midpoint',
          point: midpoint(this.points[this.points.length - 1], this.points[0]),
          entityId: this.id,
        });
      }
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    return distanceToPolyline(pt, this.points, this.closed) <= tolerance;
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (e) => {
      e.points = e.points.map((p) => applyToPoint(m, p));
    });
  }

  /** one grip per vertex */
  getGrips(): GripPoint[] {
    return this.points.map((p, index) => ({
      index,
      point: p,
      kind: 'endpoint',
    }));
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (e) => {
      if (index >= 0 && index < e.points.length) e.points[index] = to;
    });
  }

  clone(): PolylineEntity {
    const copy = new PolylineEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setPoints(this.points);
    copy.closed = this.closed;
    return copy;
  }

  protected saveProps(): JsonObject {
    return {
      points: this.points.flatMap((p) => [p.x, p.y]),
      closed: this.closed,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { points: flat, closed } = props;
    if (
      !Array.isArray(flat) ||
      flat.length % 2 !== 0 ||
      typeof closed !== 'boolean'
    ) {
      throw new ValidationError(`polyline ${this.id}: invalid props`);
    }
    const points: Point[] = [];
    for (let i = 0; i < flat.length; i += 2) {
      const x = flat[i];
      const y = flat[i + 1];
      if (typeof x !== 'number' || typeof y !== 'number') {
        throw new ValidationError(`polyline ${this.id}: invalid coordinate`);
      }
      points.push(point(x, y));
    }
    this.points = points;
    this.closed = closed;
  }
}

export function createPolylineEntity(id?: EntityId): PolylineEntity {
  return new PolylineEntity(id);
}
