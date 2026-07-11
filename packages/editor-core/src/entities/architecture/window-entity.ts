import { Entity } from '../base/entity.js';
import type { EntityId, RelationId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  angleOf,
  dot,
  lerp,
  normalize,
  perpendicular,
  point,
  scale,
  sub,
} from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import type { Geometry, SegmentShape } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import { EMPTY_MESH, extrudeQuad } from '../../geometry/mesh/index.js';
import type {
  Anchor,
  IHosted,
  IMeshable,
  IOpeningCutter,
  OpeningSpec,
  Placement,
  PlacementParams,
} from '../base/capabilities.js';
import { isHost, isLevelAware } from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

interface HasThickness {
  getThickness(): number;
}

interface WindowFrame {
  center: Point;
  u: Vector;
  n: Vector;
  halfWidth: number;
  halfThickness: number;
}

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/**
 * First hosted entity: no absolute position is ever stored. Placement derives
 * from (host anchor, t) — move the wall and the window follows because its
 * geometry is recomputed, not copied. Implementation note: the placement
 * parameter t lives in the window's own props (single update path); the
 * relation stores the anchor index.
 */
export class WindowEntity extends Entity implements IHosted, IOpeningCutter, IMeshable {
  static readonly TYPE = 'window';

  readonly type: string = WindowEntity.TYPE;

  /** normalized position of the opening center along the host axis */
  t = 0.5;
  width = 1.0;
  sill = 0.9;
  height = 1.2;

  get hostRef(): RelationId | null {
    return this.doc?.relations.relationOfHosted(this.id)?.id ?? null;
  }

  private host(): Entity | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    if (!relation) return null;
    return this.doc.get(relation.hostId);
  }

  private axisAnchor(): Anchor | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    const host = this.host();
    if (!relation || !host || !isHost(host)) return null;
    const anchors = host.getAnchors();
    const anchor = anchors[relation.anchorIndex] ?? anchors.find((a) => a.kind === 'curve');
    return anchor && anchor.geometry.kind === 'segment' ? anchor : null;
  }

  evalPlacement(anchor: Anchor, _params: PlacementParams): Placement {
    const seg = anchor.geometry as SegmentShape;
    return {
      position: lerp(seg.a, seg.b, this.t),
      rotation: angleOf(sub(seg.b, seg.a)),
    };
  }

  getOpeningSpec(): OpeningSpec {
    return { t: this.t, width: this.width, sill: this.sill, height: this.height };
  }

  private frame(): WindowFrame | null {
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

  getBaseGeometry(): Geometry {
    const frame = this.frame();
    if (!frame) {
      // detached fallback: symbol at the origin so bounds stay sane
      return { kind: 'polyline', closed: true, points: [
        point(-this.width / 2, -0.05),
        point(this.width / 2, -0.05),
        point(this.width / 2, 0.05),
        point(-this.width / 2, 0.05),
      ] };
    }
    const { center, u, n, halfWidth, halfThickness } = frame;
    const du = scale(u, halfWidth);
    const dn = scale(n, halfThickness);
    const outline: Geometry = {
      kind: 'polyline',
      closed: true,
      points: [
        add(add(center, du), dn),
        add(sub(center, du), dn),
        sub(sub(center, du), dn),
        sub(add(center, du), dn),
      ],
    };
    const glazing: Geometry = {
      kind: 'segment',
      a: sub(center, du),
      b: add(center, du),
    };
    return { kind: 'group', children: [outline, glazing] };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    const frame = this.frame();
    if (!frame) return [];
    const wanted = (kind: SnapKind): boolean => !filter || filter.includes(kind);
    const du = scale(frame.u, frame.halfWidth);
    const result: SnapPoint[] = [];
    if (wanted('node')) {
      result.push({ kind: 'node', point: frame.center, entityId: this.id });
    }
    if (wanted('endpoint')) {
      result.push({ kind: 'endpoint', point: sub(frame.center, du), entityId: this.id });
      result.push({ kind: 'endpoint', point: add(frame.center, du), entityId: this.id });
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

  /** windows move ALONG their wall: the transform is projected back onto the axis */
  transform(m: Matrix3, tx: Transaction): void {
    const anchor = this.axisAnchor();
    if (!anchor) return;
    const seg = anchor.geometry as SegmentShape;
    const frame = this.frame();
    if (!frame) return;
    const moved = applyToPoint(m, frame.center);
    const ab = sub(seg.b, seg.a);
    const lenSq = dot(ab, ab);
    const nextT = lenSq === 0 ? this.t : clamp01(dot(sub(moved, seg.a), ab) / lenSq);
    tx.update(this, (win) => {
      win.t = nextT;
    });
  }

  clone(): WindowEntity {
    const copy = new WindowEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.t = this.t;
    copy.width = this.width;
    copy.sill = this.sill;
    copy.height = this.height;
    return copy;
  }

  toMesh(_detail: MeshDetail): Mesh3D {
    const frame = this.frame();
    const host = this.host();
    if (!frame || !host) return EMPTY_MESH;
    let z0 = 0;
    if (isLevelAware(host) && host.baseLevelId && this.doc) {
      z0 = this.doc.levels.get(host.baseLevelId)?.elevation ?? 0;
    }
    const du = scale(frame.u, frame.halfWidth);
    const dn = scale(frame.n, 0.03); // thin glazing pane
    const quad: [Point, Point, Point, Point] = [
      add(add(frame.center, du), dn),
      add(sub(frame.center, du), dn),
      sub(sub(frame.center, du), dn),
      sub(add(frame.center, du), dn),
    ];
    return extrudeQuad(quad, z0 + this.sill, z0 + this.sill + this.height);
  }

  protected saveProps(): JsonObject {
    return { t: this.t, width: this.width, sill: this.sill, height: this.height };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { t, width, sill, height } = props;
    if (
      typeof t !== 'number' ||
      typeof width !== 'number' ||
      typeof sill !== 'number' ||
      typeof height !== 'number'
    ) {
      throw new ValidationError(`window ${this.id}: invalid props`);
    }
    this.t = clamp01(t);
    this.width = width;
    this.sill = sill;
    this.height = height;
  }
}

export function createWindowEntity(id?: EntityId): WindowEntity {
  return new WindowEntity(id);
}
