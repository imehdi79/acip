import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  distance,
  dot,
  midpoint,
  normalize,
  point,
  scale,
} from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import {
  applyToPoint,
  applyToVector,
} from '../../geometry/primitives/matrix3.js';
import { distanceToPolyline } from '../../geometry/curves/polyline.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import { loftPolygon } from '../../geometry/mesh/index.js';
import { loopSignedArea, pointInLoop } from '../../topology/arrangement.js';
import type {
  GripPoint,
  IGrippable,
  ILevelAware,
  IMeshable,
} from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

/**
 * Mono-pitch (skillion) roof: closed footprint + slope + fall direction.
 * The surface is a single PLANE, so the ear-clipped triangulation is exact
 * for any simple footprint — gable/hip roofs need ridge splitting and are
 * deferred. Eaves sit at level elevation + eavesHeight at the most-downhill
 * vertex; thickness (assembly wins) is measured vertically.
 * See docs/editor-core/04-systems/roofs.md.
 */
export class RoofEntity
  extends Entity
  implements ILevelAware, IMeshable, IGrippable
{
  static readonly TYPE = 'roof';

  readonly type: string = RoofEntity.TYPE;

  private footprint: Point[] = [point(0, 0), point(1, 0), point(1, 1)];
  /** pitch in degrees, 0 = flat */
  slope = 15;
  /** downhill fall direction in plan */
  direction: Vector = { x: 0, y: -1 };
  /** eaves above the level elevation (a storey of walls by default) */
  eavesHeight = 3;
  thickness = 0.25;
  /** created by ROOF.AUTO — replaced on the next regeneration */
  auto = false;
  baseLevelId: LevelId | null = null;
  vertical: { height: number } = { height: 0 };

  getFootprint(): readonly Point[] {
    return this.footprint;
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setFootprint(points: readonly Point[]): void {
    this.footprint = [...points];
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

  getPlanArea(): number {
    return Math.abs(loopSignedArea(this.footprint));
  }

  /** plan-footprint perimeter — the reference length for edge (m) materials */
  getPerimeter(): number {
    let total = 0;
    for (let i = 0; i < this.footprint.length; i++) {
      total += distance(
        this.footprint[i],
        this.footprint[(i + 1) % this.footprint.length],
      );
    }
    return total;
  }

  /** the sloped surface area — what roofing trades price */
  getSlopeArea(): number {
    return this.getPlanArea() / Math.cos((this.slope * Math.PI) / 180);
  }

  /** top-surface height per footprint vertex (plane: exact at any vertex) */
  private topHeights(): number[] {
    const uphill = normalize(scale(this.direction, -1));
    const rise = Math.tan((this.slope * Math.PI) / 180);
    const projections = this.footprint.map((p) => dot(p, uphill));
    const low = Math.min(...projections);
    const eaves = this.baseElevation() + this.eavesHeight;
    return projections.map((proj) => eaves + rise * (proj - low));
  }

  getBaseGeometry(): Geometry {
    // footprint region + a fall arrow at the centroid (plan symbol)
    const d = normalize(this.direction);
    let cx = 0;
    let cy = 0;
    for (const p of this.footprint) {
      cx += p.x;
      cy += p.y;
    }
    const c = point(cx / this.footprint.length, cy / this.footprint.length);
    const tail = add(c, scale(d, -0.5));
    const tip = add(c, scale(d, 0.5));
    const barb = (angle: number): Point => {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      return add(
        tip,
        scale({ x: d.x * cos - d.y * sin, y: d.x * sin + d.y * cos }, -0.25),
      );
    };
    return {
      kind: 'group',
      children: [
        { kind: 'region', boundary: this.footprint, holes: [] },
        { kind: 'segment', a: tail, b: tip },
        { kind: 'segment', a: tip, b: barb(Math.PI / 8) },
        { kind: 'segment', a: tip, b: barb(-Math.PI / 8) },
      ],
    };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean =>
      !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    for (let i = 0; i < this.footprint.length; i++) {
      if (wanted('endpoint')) {
        result.push({
          kind: 'endpoint',
          point: this.footprint[i],
          entityId: this.id,
        });
      }
      if (wanted('midpoint')) {
        result.push({
          kind: 'midpoint',
          point: midpoint(
            this.footprint[i],
            this.footprint[(i + 1) % this.footprint.length],
          ),
          entityId: this.id,
        });
      }
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    return (
      pointInLoop(pt, this.footprint) ||
      distanceToPolyline(pt, this.footprint, true) <= tolerance
    );
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (roof) => {
      roof.footprint = roof.footprint.map((p) => applyToPoint(m, p));
      roof.direction = normalize(applyToVector(m, roof.direction));
    });
  }

  getGrips(): GripPoint[] {
    return this.footprint.map((p, index) => ({
      index,
      point: p,
      kind: 'endpoint',
    }));
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (roof) => {
      roof.footprint[index] = to;
    });
  }

  clone(): RoofEntity {
    const copy = new RoofEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setFootprint(this.footprint);
    copy.slope = this.slope;
    copy.direction = this.direction;
    copy.eavesHeight = this.eavesHeight;
    copy.thickness = this.thickness;
    copy.auto = this.auto;
    copy.baseLevelId = this.baseLevelId;
    return copy;
  }

  toMesh(_detail: MeshDetail): Mesh3D {
    const top = this.topHeights();
    const thickness = this.getThickness();
    return loftPolygon(
      this.footprint,
      top.map((z) => z - thickness),
      top,
    );
  }

  baseElevation(): number {
    if (this.baseLevelId && this.doc) {
      return this.doc.levels.get(this.baseLevelId)?.elevation ?? 0;
    }
    return 0;
  }

  protected saveProps(): JsonObject {
    const points: number[] = [];
    for (const p of this.footprint) points.push(p.x, p.y);
    return {
      points,
      slope: this.slope,
      dirX: this.direction.x,
      dirY: this.direction.y,
      eavesHeight: this.eavesHeight,
      thickness: this.thickness,
      auto: this.auto,
      baseLevelId: this.baseLevelId,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { points, slope, dirX, dirY, eavesHeight, thickness } = props;
    if (
      !Array.isArray(points) ||
      points.length < 6 ||
      points.length % 2 !== 0 ||
      points.some((v) => typeof v !== 'number') ||
      typeof slope !== 'number' ||
      typeof dirX !== 'number' ||
      typeof dirY !== 'number' ||
      typeof eavesHeight !== 'number' ||
      typeof thickness !== 'number'
    ) {
      throw new ValidationError(`roof ${this.id}: invalid props`);
    }
    const footprint: Point[] = [];
    for (let i = 0; i < points.length; i += 2) {
      footprint.push(point(points[i] as number, points[i + 1] as number));
    }
    this.footprint = footprint;
    this.slope = slope;
    this.direction = { x: dirX, y: dirY };
    this.eavesHeight = eavesHeight;
    this.thickness = thickness;
    this.auto = props['auto'] === true;
    this.baseLevelId =
      typeof props['baseLevelId'] === 'string'
        ? (props['baseLevelId'] as LevelId)
        : null;
  }
}

export function createRoofEntity(id?: EntityId): RoofEntity {
  return new RoofEntity(id);
}
