import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  distance,
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
import { distanceToSegment } from '../../geometry/curves/segment.js';
import type { Geometry, RegionShape } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import { extrudeQuad, mergeMeshes } from '../../geometry/mesh/index.js';
import type { Interval } from '../../topology/intervals.js';
import { subtractIntervals } from '../../topology/intervals.js';
import type {
  Anchor,
  IHost,
  ILevelAware,
  IMeshable,
  OpeningSpec,
} from '../base/capabilities.js';
import { cutsOpening } from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

/**
 * First semantic entity: baseline + thickness + height. Hosts openings
 * (windows, doors) on its axis anchor; effective plan geometry is the solid
 * spans between openings; 3D is a straight extrusion with opening bands.
 */
export class WallEntity extends Entity implements IHost, ILevelAware, IMeshable {
  static readonly TYPE = 'wall';

  readonly type: string = WallEntity.TYPE;

  private a: Point = point(0, 0);
  private b: Point = point(1, 0);
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

  override getEffectiveGeometry(): Geometry {
    if (!this.doc) return this.getBaseGeometry();
    const spans = this.getSolidSpans();
    if (spans.length === 0) {
      // fully consumed by openings — keep the baseline so bounds stay sane
      return { kind: 'segment', a: this.a, b: this.b };
    }
    const regions = spans.map((s) => this.spanRegion(s.start, s.end));
    if (regions.length === 1 && spans[0].start === 0 && spans[0].end === this.getLength()) {
      return regions[0];
    }
    return { kind: 'group', children: regions };
  }

  getAnchors(): Anchor[] {
    const half = scale(this.normal(), this.getThickness() / 2);
    return [
      { kind: 'curve', geometry: { kind: 'segment', a: this.a, b: this.b }, name: 'axis' },
      {
        kind: 'face',
        geometry: { kind: 'segment', a: add(this.a, half), b: add(this.b, half) },
        name: 'face+',
      },
      {
        kind: 'face',
        geometry: { kind: 'segment', a: sub(this.a, half), b: sub(this.b, half) },
        name: 'face-',
      },
    ];
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const wanted = (kind: SnapKind): boolean => !filter || filter.includes(kind);
    const result: SnapPoint[] = [];
    if (wanted('endpoint')) {
      result.push({ kind: 'endpoint', point: this.a, entityId: this.id });
      result.push({ kind: 'endpoint', point: this.b, entityId: this.id });
    }
    if (wanted('midpoint')) {
      result.push({ kind: 'midpoint', point: midpoint(this.a, this.b), entityId: this.id });
    }
    return result;
  }

  hitTest(pt: Point, tolerance: number): boolean {
    return distanceToSegment(pt, this.a, this.b) <= this.getThickness() / 2 + tolerance;
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (wall) => {
      wall.setBaseline(applyToPoint(m, wall.a), applyToPoint(m, wall.b));
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
    return copy;
  }

  toMesh(_detail: MeshDetail): Mesh3D {
    const z0 = this.baseElevation();
    const height = this.getHeight();
    const len = this.getLength();
    const meshes: Mesh3D[] = [];
    for (const span of this.getSolidSpans()) {
      meshes.push(extrudeQuad(this.spanQuad(span.start, span.end), z0, z0 + height));
    }
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
      typeof props['baseLevelId'] === 'string' ? (props['baseLevelId'] as LevelId) : null;
  }
}

export function createWallEntity(id?: EntityId): WallEntity {
  return new WallEntity(id);
}
