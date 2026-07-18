import { Entity } from '../base/entity.js';
import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { midpoint, point } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import { distanceToSegment } from '../../geometry/curves/segment.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { GripPoint, IGrippable } from '../base/capabilities.js';
import type { Transaction } from '../../document/history/transaction.js';

/** Reference implementation of the Entity contract. */
export class LineEntity extends Entity implements IGrippable {
  static readonly TYPE = 'line';

  readonly type: string = LineEntity.TYPE;

  private a: Point = point(0, 0);
  private b: Point = point(0, 0);

  getPoints(): { a: Point; b: Point } {
    return { a: this.a, b: this.b };
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setPoints(a: Point, b: Point): void {
    this.a = a;
    this.b = b;
  }

  getBaseGeometry(): Geometry {
    return { kind: 'segment', a: this.a, b: this.b };
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
    return distanceToSegment(pt, this.a, this.b) <= tolerance;
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (e) => {
      e.setPoints(applyToPoint(m, e.a), applyToPoint(m, e.b));
    });
  }

  getGrips(): GripPoint[] {
    return [
      { index: 0, point: this.a, kind: 'endpoint' },
      { index: 1, point: this.b, kind: 'endpoint' },
    ];
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (e) => {
      if (index === 0) e.a = to;
      else e.b = to;
    });
  }

  clone(): LineEntity {
    const copy = new LineEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setPoints(this.a, this.b);
    return copy;
  }

  protected saveProps(): JsonObject {
    return { ax: this.a.x, ay: this.a.y, bx: this.b.x, by: this.b.y };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { ax, ay, bx, by } = props;
    if (
      typeof ax !== 'number' ||
      typeof ay !== 'number' ||
      typeof bx !== 'number' ||
      typeof by !== 'number'
    ) {
      throw new ValidationError(`line ${this.id}: invalid props`);
    }
    this.a = point(ax, ay);
    this.b = point(bx, by);
  }
}

export function createLineEntity(id?: EntityId): LineEntity {
  return new LineEntity(id);
}
