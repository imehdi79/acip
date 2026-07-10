import type { EntityId } from '../../common/id.js';
import type { BBox } from '../../geometry/primitives/bbox.js';
import { bboxIntersects } from '../../geometry/primitives/bbox.js';

export interface SpatialIndex {
  insert(id: EntityId, bounds: BBox): void;
  update(id: EntityId, bounds: BBox): void;
  remove(id: EntityId): void;
  query(area: BBox): EntityId[];
}

/**
 * Linear-scan placeholder behind the real interface. Swap for an R-tree when
 * entity counts demand it (same interface, no caller changes).
 */
export class NaiveSpatialIndex implements SpatialIndex {
  private boxes = new Map<EntityId, BBox>();

  insert(id: EntityId, bounds: BBox): void {
    this.boxes.set(id, bounds);
  }

  update(id: EntityId, bounds: BBox): void {
    this.boxes.set(id, bounds);
  }

  remove(id: EntityId): void {
    this.boxes.delete(id);
  }

  query(area: BBox): EntityId[] {
    const hits: EntityId[] = [];
    for (const [id, box] of this.boxes) {
      if (bboxIntersects(area, box)) hits.push(id);
    }
    return hits;
  }
}
