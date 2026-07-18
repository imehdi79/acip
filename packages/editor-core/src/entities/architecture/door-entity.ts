import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import {
  add,
  angleOf,
  point,
  scale,
  sub,
} from '../../geometry/primitives/point.js';
import type { Geometry } from '../../geometry/shapes.js';
import { HostedOpeningEntity, clamp01 } from './hosted-opening.js';

/**
 * Door: hosted opening with sill 0 (cuts the wall to the floor). Plan symbol
 * is the classic leaf + quarter-circle swing arc; no 3D contribution — the
 * opening in the wall mesh is the door's 3D presence for now.
 */
export class DoorEntity extends HostedOpeningEntity {
  static readonly TYPE = 'door';

  readonly type: string = DoorEntity.TYPE;

  override width = 0.9;

  override height = 2.1;

  /** which side of the wall the leaf swings to: +1 or -1 */
  swing: 1 | -1 = 1;

  getSillHeight(): number {
    return 0;
  }

  getBaseGeometry(): Geometry {
    const frame = this.frame();
    if (!frame) {
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
    const { center, u, n, halfWidth } = frame;
    const hinge = sub(center, scale(u, halfWidth));
    const swingDir = scale(n, this.swing);
    const leafTip = add(hinge, scale(swingDir, this.width));
    const leaf: Geometry = { kind: 'segment', a: hinge, b: leafTip };
    // quarter arc from the wall direction to the leaf, built directly so
    // angle wrap-around can't flip it
    const base = angleOf(u);
    const arc: Geometry = {
      kind: 'arc',
      center: hinge,
      radius: this.width,
      startAngle: this.swing === 1 ? base : base - Math.PI / 2,
      endAngle: this.swing === 1 ? base + Math.PI / 2 : base,
    };
    return { kind: 'group', children: [leaf, arc] };
  }

  clone(): DoorEntity {
    const copy = new DoorEntity();
    copy.layerId = this.layerId;
    copy.typeRef = this.typeRef;
    copy.t = this.t;
    copy.width = this.width;
    copy.height = this.height;
    copy.swing = this.swing;
    return copy;
  }

  protected saveProps(): JsonObject {
    return {
      t: this.t,
      width: this.width,
      height: this.height,
      swing: this.swing,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { t, width, height, swing } = props;
    if (
      typeof t !== 'number' ||
      typeof width !== 'number' ||
      typeof height !== 'number' ||
      (swing !== 1 && swing !== -1)
    ) {
      throw new ValidationError(`door ${this.id}: invalid props`);
    }
    this.t = clamp01(t);
    this.width = width;
    this.height = height;
    this.swing = swing;
  }
}

export function createDoorEntity(id?: EntityId): DoorEntity {
  return new DoorEntity(id);
}
