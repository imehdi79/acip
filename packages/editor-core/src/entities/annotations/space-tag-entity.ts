import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { point } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import type { BBox } from '../../geometry/primitives/bbox.js';
import type { Geometry } from '../../geometry/shapes.js';
import type { ILevelAware } from '../base/capabilities.js';
import type { SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

/**
 * A name for a detected space (room). Spaces themselves are derived geometry
 * and are never stored — so naming one cannot be a property of the room; it is
 * this thin tag, anchored at a point INSIDE the room it names. Move the walls
 * and the room changes shape, but as long as the tag point is still inside it,
 * the name follows. See docs/editor-core/04-systems/spaces.md.
 *
 * The tag stores data, never geometry: it draws no linework of its own, and
 * consumers render the name wherever they put the room label.
 */
export class SpaceTagEntity extends Entity implements ILevelAware {
  static readonly TYPE = 'space-tag';

  readonly type: string = SpaceTagEntity.TYPE;

  name = '';
  baseLevelId: LevelId | null = null;
  /** a label has no vertical extent — present so plan views can scope it */
  vertical: { height: number } = { height: 0 };

  private at: Point = point(0, 0);

  getPoint(): Point {
    return this.at;
  }

  /** call inside tx.update(...) — never mutate outside a transaction */
  setPoint(at: Point): void {
    this.at = at;
  }

  /** nothing to draw: the name rides on whatever label the room already has */
  getBaseGeometry(): Geometry {
    return { kind: 'group', children: [] };
  }

  /** an empty group has no bounds of its own, so pin them to the anchor */
  override getBounds(): BBox {
    return {
      minX: this.at.x,
      minY: this.at.y,
      maxX: this.at.x,
      maxY: this.at.y,
    };
  }

  getSnapPoints(): SnapPoint[] {
    return [];
  }

  /** deliberately unpickable: a tap inside the room must still select the room */
  hitTest(): boolean {
    return false;
  }

  transform(m: Matrix3, tx: Transaction): void {
    tx.update(this, (tag) => {
      tag.at = applyToPoint(m, tag.at);
    });
  }

  clone(): SpaceTagEntity {
    const copy = new SpaceTagEntity();
    copy.layerId = this.layerId;
    copy.name = this.name;
    copy.baseLevelId = this.baseLevelId;
    copy.setPoint(this.at);
    return copy;
  }

  protected saveProps(): JsonObject {
    return {
      name: this.name,
      x: this.at.x,
      y: this.at.y,
      baseLevelId: this.baseLevelId,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { name, x, y } = props;
    if (
      typeof name !== 'string' ||
      typeof x !== 'number' ||
      typeof y !== 'number'
    ) {
      throw new ValidationError(`space tag ${this.id}: invalid props`);
    }
    this.name = name;
    this.at = point(x, y);
    this.baseLevelId =
      typeof props['baseLevelId'] === 'string'
        ? (props['baseLevelId'] as LevelId)
        : null;
  }
}

export function createSpaceTagEntity(id?: EntityId): SpaceTagEntity {
  return new SpaceTagEntity(id);
}
