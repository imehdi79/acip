import type { EntityId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import {
  add,
  angleOf,
  cross,
  point,
  scale,
} from '../../geometry/primitives/point.js';
import type { Geometry } from '../../geometry/shapes.js';
import {
  HostedOpeningEntity,
  asOpeningThickness,
  clamp01,
} from './hosted-opening.js';
import { asPhase } from './phase.js';

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

  /**
   * Which jamb the leaf is hung on, along the wall: -1 is the end the wall
   * runs FROM, +1 the end it runs to. Together with `swing` this is the whole
   * of how a door hangs — the four combinations a joiner would ask about.
   */
  hinge: 1 | -1 = -1;

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
    const pivot = add(center, scale(u, halfWidth * this.hinge));
    // shut, the leaf lies along the wall from its hinge towards the far jamb;
    // open, it stands off the face the door swings to
    const shut = scale(u, -this.hinge);
    const open = scale(n, this.swing);
    const leaf: Geometry = {
      kind: 'segment',
      a: pivot,
      b: add(pivot, scale(open, this.width)),
    };
    // the arc always sweeps the same quarter the leaf covers; taking whichever
    // of the two limbs comes first counter-clockwise keeps it that way for all
    // four ways the door can hang, without wrap-around flipping it
    const start = angleOf(cross(shut, open) > 0 ? shut : open);
    const arc: Geometry = {
      kind: 'arc',
      center: pivot,
      radius: this.width,
      startAngle: start,
      endAngle: start + Math.PI / 2,
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
    copy.thickness = this.thickness;
    copy.swing = this.swing;
    copy.hinge = this.hinge;
    copy.phase = this.phase;
    return copy;
  }

  protected saveProps(): JsonObject {
    return {
      t: this.t,
      width: this.width,
      height: this.height,
      thickness: this.thickness,
      swing: this.swing,
      hinge: this.hinge,
      phase: this.phase,
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
    this.thickness = asOpeningThickness(props['thickness']);
    this.swing = swing;
    // drawings written before doors could be hung on either jamb have none,
    // and they all hung on the same one
    this.hinge = props['hinge'] === 1 ? 1 : -1;
    this.phase = asPhase(props['phase']);
  }
}

export function createDoorEntity(id?: EntityId): DoorEntity {
  return new DoorEntity(id);
}
