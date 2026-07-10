import type { Point } from './primitives/point.js';
import type { BBox } from './primitives/bbox.js';
import { bboxFromPoints, bboxUnion } from './primitives/bbox.js';

export interface SegmentShape {
  readonly kind: 'segment';
  readonly a: Point;
  readonly b: Point;
}

export interface PolylineShape {
  readonly kind: 'polyline';
  readonly points: readonly Point[];
  readonly closed: boolean;
}

export interface CircleShape {
  readonly kind: 'circle';
  readonly center: Point;
  readonly radius: number;
}

export interface ArcShape {
  readonly kind: 'arc';
  readonly center: Point;
  readonly radius: number;
  readonly startAngle: number;
  readonly endAngle: number;
}

export interface RegionShape {
  readonly kind: 'region';
  readonly boundary: readonly Point[];
  readonly holes: readonly (readonly Point[])[];
}

export interface GroupShape {
  readonly kind: 'group';
  readonly children: readonly Geometry[];
}

export type Geometry =
  | SegmentShape
  | PolylineShape
  | CircleShape
  | ArcShape
  | RegionShape
  | GroupShape;

const EMPTY_BBOX: BBox = { minX: 0, minY: 0, maxX: 0, maxY: 0 };

export function geometryBBox(g: Geometry): BBox {
  switch (g.kind) {
    case 'segment':
      return bboxFromPoints([g.a, g.b]);
    case 'polyline':
      return bboxFromPoints(g.points);
    case 'circle':
    case 'arc':
      // arc bounds are conservative (full circle)
      return {
        minX: g.center.x - g.radius,
        minY: g.center.y - g.radius,
        maxX: g.center.x + g.radius,
        maxY: g.center.y + g.radius,
      };
    case 'region':
      return bboxFromPoints(g.boundary);
    case 'group': {
      if (g.children.length === 0) return EMPTY_BBOX;
      let box = geometryBBox(g.children[0]);
      for (let i = 1; i < g.children.length; i++) {
        box = bboxUnion(box, geometryBBox(g.children[i]));
      }
      return box;
    }
  }
}
