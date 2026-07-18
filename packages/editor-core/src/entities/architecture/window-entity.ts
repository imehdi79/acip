import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import { add, point, scale, sub } from '../../geometry/primitives/point.js';
import type { Point } from '../../geometry/primitives/point.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { Mesh3D, MeshDetail } from '../../geometry/mesh/index.js';
import { EMPTY_MESH, extrudeQuad } from '../../geometry/mesh/index.js';
import type { IMeshable } from '../base/capabilities.js';
import { HostedOpeningEntity, clamp01 } from './hosted-opening.js';

/**
 * Window: hosted opening with a sill and a glazing pane. Plan symbol is the
 * opening outline plus a glazing line; 3D contributes a thin pane.
 */
export class WindowEntity extends HostedOpeningEntity implements IMeshable {
  static readonly TYPE = 'window';

  readonly type: string = WindowEntity.TYPE;

  sill = 0.9;

  override height = 1.2;

  getSillHeight(): number {
    return this.sill;
  }

  getBaseGeometry(): Geometry {
    const frame = this.frame();
    if (!frame) {
      // detached fallback: symbol at the origin so bounds stay sane
      return {
        kind: 'polyline',
        closed: true,
        points: [
          point(-this.width / 2, -0.05),
          point(this.width / 2, -0.05),
          point(this.width / 2, 0.05),
          point(-this.width / 2, 0.05),
        ],
      };
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
    if (!frame) return EMPTY_MESH;
    const z0 = this.hostElevation();
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
    return {
      t: this.t,
      width: this.width,
      sill: this.sill,
      height: this.height,
    };
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
