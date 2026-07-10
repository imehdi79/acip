import type { Point } from '../geometry/primitives/point.js';
import { distance } from '../geometry/primitives/point.js';
import { bboxExpand, bboxFromPoints } from '../geometry/primitives/bbox.js';
import type { SnapKind, SnapPoint } from '../entities/base/snap.js';
import type { DrawingDocument } from '../document/document.js';

/**
 * Gathers entity-provided snap points near the cursor and picks the closest
 * within tolerance. Provider-based snap kinds (intersection, perpendicular…)
 * extend this later via registration.
 */
export class SnapEngine {
  constructor(private doc: DrawingDocument) {}

  snap(cursor: Point, tolerance: number, filter?: readonly SnapKind[]): SnapPoint | null {
    const area = bboxExpand(bboxFromPoints([cursor]), tolerance);
    let best: SnapPoint | null = null;
    let bestDist = Infinity;
    for (const entity of this.doc.queryBBox(area)) {
      for (const sp of entity.getSnapPoints(filter)) {
        const d = distance(cursor, sp.point);
        if (d <= tolerance && d < bestDist) {
          best = sp;
          bestDist = d;
        }
      }
    }
    return best;
  }
}
