import type { EntityId } from '../common/id.js';
import type { Point } from '../geometry/primitives/point.js';
import { distance } from '../geometry/primitives/point.js';
import type { Geometry } from '../geometry/shapes.js';
import type { DrawingDocument } from '../document/document.js';

function polylineLength(points: readonly Point[], closed: boolean): number {
  let total = 0;
  for (let i = 1; i < points.length; i++)
    total += distance(points[i - 1], points[i]);
  if (closed && points.length > 1)
    total += distance(points[points.length - 1], points[0]);
  return total;
}

function shoelaceArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

export function geometryLength(g: Geometry): number | null {
  switch (g.kind) {
    case 'segment':
      return distance(g.a, g.b);
    case 'polyline':
      return polylineLength(g.points, g.closed);
    case 'circle':
      return 2 * Math.PI * g.radius;
    case 'arc': {
      let sweep = g.endAngle - g.startAngle;
      if (sweep < 0) sweep += 2 * Math.PI;
      return g.radius * sweep;
    }
    default:
      return null;
  }
}

export function geometryArea(g: Geometry): number | null {
  switch (g.kind) {
    case 'circle':
      return Math.PI * g.radius * g.radius;
    case 'polyline':
      return g.closed ? shoelaceArea(g.points) : null;
    case 'region': {
      let area = shoelaceArea(g.boundary);
      for (const hole of g.holes) area -= shoelaceArea(hole);
      return area;
    }
    case 'group': {
      // sum of measurable children (a wall's solid spans between openings)
      let total: number | null = null;
      for (const child of g.children) {
        const a = geometryArea(child);
        if (a !== null) total = (total ?? 0) + a;
      }
      return total;
    }
    default:
      return null;
  }
}

export type {
  WallQuantity,
  SlabQuantity,
  RoofQuantity,
  FinishQuantity,
  StairQuantity,
  MaterialQuantity,
  QuantityReport,
} from './quantities.js';
export { computeQuantities } from './quantities.js';
export type { LayerRefs } from './layer-quantity.js';
export { layerQuantity } from './layer-quantity.js';
export type { SpaceInfo, OutlineInfo } from './spaces.js';
export { detectSpaces, detectOutlines, offsetBoundary } from './spaces.js';

/**
 * Read-only queries over EFFECTIVE geometry (openings already subtracted) —
 * what the estimator and agents consume.
 */
export class MeasurementService {
  constructor(private doc: DrawingDocument) {}

  lengthOf(id: EntityId): number | null {
    const entity = this.doc.get(id);
    return entity ? geometryLength(entity.getEffectiveGeometry()) : null;
  }

  areaOf(id: EntityId): number | null {
    const entity = this.doc.get(id);
    return entity ? geometryArea(entity.getEffectiveGeometry()) : null;
  }
}
