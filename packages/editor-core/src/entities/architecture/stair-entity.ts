import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import { add, distance, normalize, perpendicular, point, scale, sub } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint, applyToVector } from '../../geometry/primitives/matrix3.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import { extrudeQuad, mergeMeshes } from '../../geometry/mesh/index.js';
import { pointInLoop } from '../../topology/arrangement.js';
import type { GripPoint, IGrippable, ILevelAware, IMeshable } from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

/** target maximum riser; the actual riser lands under this */
const MAX_RISER = 0.19;
/** tread depth (going) */
const GOING = 0.28;
const DEFAULT_WIDTH = 1.0;

/**
 * A straight-flight stair — the first entity spanning two levels, and the
 * first user of the `{topLevelId}` variant of ILevelAware. Stores only intent
 * (origin, direction, width, base + top); rise, riser count and run length
 * derive on read from the two level datums, so raising the top level
 * re-treads the stair. See docs/editor-core/04-systems/stairs.md.
 */
export class StairEntity extends Entity implements ILevelAware, IMeshable, IGrippable {
  static readonly TYPE = 'stair';

  readonly type: string = StairEntity.TYPE;

  private origin: Point = point(0, 0);
  private direction: Vector = { x: 1, y: 0 };
  width = DEFAULT_WIDTH;
  baseLevelId: LevelId | null = null;
  vertical: { height: number } | { topLevelId: LevelId } = { height: 3 };

  getOrigin(): Point {
    return this.origin;
  }

  getDirection(): Vector {
    return this.direction;
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setRun(origin: Point, direction: Vector): void {
    this.origin = origin;
    this.direction = normalize(direction);
  }

  baseElevation(): number {
    if (this.baseLevelId && this.doc) {
      return this.doc.levels.get(this.baseLevelId)?.elevation ?? 0;
    }
    return 0;
  }

  /** total vertical rise between the two levels (or the flat height) */
  getRise(): number {
    if ('topLevelId' in this.vertical) {
      const topElev = this.doc?.levels.get(this.vertical.topLevelId)?.elevation ?? this.baseElevation();
      return Math.max(0, topElev - this.baseElevation());
    }
    return this.vertical.height;
  }

  getRiserCount(): number {
    return Math.max(1, Math.ceil(this.getRise() / MAX_RISER));
  }

  getRiser(): number {
    return this.getRise() / this.getRiserCount();
  }

  getRunLength(): number {
    return this.getRiserCount() * GOING;
  }

  private end(): Point {
    return add(this.origin, scale(this.direction, this.getRunLength()));
  }

  /** the four flight-outline corners, counter-clockwise */
  private corners(): [Point, Point, Point, Point] {
    const n = scale(perpendicular(this.direction), this.width / 2);
    const end = this.end();
    return [add(this.origin, n), add(end, n), sub(end, n), sub(this.origin, n)];
  }

  getBaseGeometry(): Geometry {
    const [c0, c1, c2, c3] = this.corners();
    const n = scale(perpendicular(this.direction), this.width / 2);
    const steps = this.getRiserCount();
    const children: Geometry[] = [
      { kind: 'polyline', points: [c0, c1, c2, c3], closed: true },
    ];
    // tread lines across the flight
    for (let i = 1; i < steps; i++) {
      const p = add(this.origin, scale(this.direction, i * GOING));
      children.push({ kind: 'segment', a: add(p, n), b: sub(p, n) });
    }
    // up-arrow along the centerline
    const end = this.end();
    const tip = sub(end, scale(this.direction, GOING * 0.4));
    const back = scale(this.direction, GOING);
    children.push({ kind: 'segment', a: this.origin, b: tip });
    children.push({ kind: 'segment', a: tip, b: add(sub(tip, back), scale(n, 0.6)) });
    children.push({ kind: 'segment', a: tip, b: sub(sub(tip, back), scale(n, 0.6)) });
    return { kind: 'group', children };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    if (filter && !filter.includes('endpoint')) return [];
    return this.corners().map((point) => ({ kind: 'endpoint', point, entityId: this.id }));
  }

  hitTest(pt: Point, _tolerance: number): boolean {
    return pointInLoop(pt, this.corners());
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (stair) => {
      stair.origin = applyToPoint(m, stair.origin);
      stair.direction = normalize(applyToVector(m, stair.direction));
    });
  }

  getGrips(): GripPoint[] {
    return [
      { index: 0, point: this.origin, kind: 'position' },
      { index: 1, point: this.end(), kind: 'endpoint' },
    ];
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (stair) => {
      if (index === 0) stair.origin = to;
      else if (distance(to, stair.origin) > 1e-9) stair.direction = normalize(sub(to, stair.origin));
    });
  }

  clone(): StairEntity {
    const copy = new StairEntity();
    copy.layerId = this.layerId;
    copy.setRun(this.origin, this.direction);
    copy.width = this.width;
    copy.baseLevelId = this.baseLevelId;
    copy.vertical = { ...this.vertical };
    return copy;
  }

  toMesh(_detail: MeshDetail): Mesh3D {
    const z0 = this.baseElevation();
    const riser = this.getRiser();
    const n = scale(perpendicular(this.direction), this.width / 2);
    const meshes: Mesh3D[] = [];
    const steps = this.getRiserCount();
    for (let i = 0; i < steps; i++) {
      const a = add(this.origin, scale(this.direction, i * GOING));
      const b = add(this.origin, scale(this.direction, (i + 1) * GOING));
      const quad: [Point, Point, Point, Point] = [add(a, n), add(b, n), sub(b, n), sub(a, n)];
      meshes.push(extrudeQuad(quad, z0, z0 + (i + 1) * riser));
    }
    return mergeMeshes(meshes);
  }

  protected saveProps(): JsonObject {
    return {
      ox: this.origin.x,
      oy: this.origin.y,
      dx: this.direction.x,
      dy: this.direction.y,
      width: this.width,
      baseLevelId: this.baseLevelId,
      topLevelId: 'topLevelId' in this.vertical ? this.vertical.topLevelId : null,
      height: 'height' in this.vertical ? this.vertical.height : null,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { ox, oy, dx, dy, width } = props;
    if (
      typeof ox !== 'number' ||
      typeof oy !== 'number' ||
      typeof dx !== 'number' ||
      typeof dy !== 'number' ||
      typeof width !== 'number'
    ) {
      throw new ValidationError(`stair ${this.id}: invalid props`);
    }
    this.origin = point(ox, oy);
    this.direction = normalize(point(dx, dy));
    this.width = width;
    this.baseLevelId =
      typeof props['baseLevelId'] === 'string' ? (props['baseLevelId'] as LevelId) : null;
    if (typeof props['topLevelId'] === 'string') {
      this.vertical = { topLevelId: props['topLevelId'] as LevelId };
    } else {
      this.vertical = { height: typeof props['height'] === 'number' ? props['height'] : 3 };
    }
  }
}

export function createStairEntity(id?: EntityId): StairEntity {
  return new StairEntity(id);
}
