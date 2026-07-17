import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { distance, midpoint, point } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import { distanceToPolyline } from '../../geometry/curves/polyline.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import { extrudePolygon } from '../../geometry/mesh/index.js';
import { loopSignedArea, pointInLoop } from '../../topology/arrangement.js';
import type { GripPoint, IGrippable, ILevelAware, IMeshable } from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

/**
 * First area entity: a closed polygon footprint + level + assembly build-up.
 * The top face sits flush with the level elevation and the body extrudes
 * DOWNWARD by the assembly thickness — you stand on the level; a storey's
 * slab underside is the storey below's ceiling.
 * See docs/editor-core/04-systems/slabs.md.
 */
export class SlabEntity extends Entity implements ILevelAware, IMeshable, IGrippable {
  static readonly TYPE = 'slab';

  readonly type: string = SlabEntity.TYPE;

  private footprint: Point[] = [point(0, 0), point(1, 0), point(1, 1)];
  thickness = 0.2;
  /** created by SLAB.AUTO — replaced on the next regeneration */
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

  getArea(): number {
    return Math.abs(loopSignedArea(this.footprint));
  }

  /** footprint perimeter — the reference length for edge (m) materials */
  getPerimeter(): number {
    let total = 0;
    for (let i = 0; i < this.footprint.length; i++) {
      total += distance(this.footprint[i], this.footprint[(i + 1) % this.footprint.length]);
    }
    return total;
  }

  getBaseGeometry(): Geometry {
    return { kind: 'region', boundary: this.footprint, holes: [] };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean => !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    for (let i = 0; i < this.footprint.length; i++) {
      if (wanted('endpoint')) {
        result.push({ kind: 'endpoint', point: this.footprint[i], entityId: this.id });
      }
      if (wanted('midpoint')) {
        result.push({
          kind: 'midpoint',
          point: midpoint(this.footprint[i], this.footprint[(i + 1) % this.footprint.length]),
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
    tx.update(this, (slab) => {
      slab.footprint = slab.footprint.map((p) => applyToPoint(m, p));
    });
  }

  getGrips(): GripPoint[] {
    return this.footprint.map((p, index) => ({ index, point: p, kind: 'endpoint' }));
  }

  moveGrip(index: number, to: Point, tx: Transaction): void {
    tx.update(this, (slab) => {
      slab.footprint[index] = to;
    });
  }

  clone(): SlabEntity {
    const copy = new SlabEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.setFootprint(this.footprint);
    copy.thickness = this.thickness;
    copy.auto = this.auto;
    copy.baseLevelId = this.baseLevelId;
    return copy;
  }

  toMesh(_detail: MeshDetail): Mesh3D {
    const top = this.baseElevation();
    return extrudePolygon(this.footprint, top - this.getThickness(), top);
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
      thickness: this.thickness,
      auto: this.auto,
      baseLevelId: this.baseLevelId,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { points, thickness } = props;
    if (
      !Array.isArray(points) ||
      points.length < 6 ||
      points.length % 2 !== 0 ||
      points.some((v) => typeof v !== 'number') ||
      typeof thickness !== 'number'
    ) {
      throw new ValidationError(`slab ${this.id}: invalid props`);
    }
    const footprint: Point[] = [];
    for (let i = 0; i < points.length; i += 2) {
      footprint.push(point(points[i] as number, points[i + 1] as number));
    }
    this.footprint = footprint;
    this.thickness = thickness;
    this.auto = props['auto'] === true;
    this.baseLevelId =
      typeof props['baseLevelId'] === 'string' ? (props['baseLevelId'] as LevelId) : null;
  }
}

export function createSlabEntity(id?: EntityId): SlabEntity {
  return new SlabEntity(id);
}
