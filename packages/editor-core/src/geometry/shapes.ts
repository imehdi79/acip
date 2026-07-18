import type { Point } from './primitives/point.js';
import { angleOf, length } from './primitives/point.js';
import type { BBox } from './primitives/bbox.js';
import { bboxFromPoints, bboxUnion } from './primitives/bbox.js';
import type { Matrix3 } from './primitives/matrix3.js';
import { applyToPoint, applyToVector } from './primitives/matrix3.js';

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

/**
 * Text as geometry (dimension values, labels). Core is headless and never
 * measures fonts — bounds are a conservative estimate; DRAWING the text is
 * the renderer's job like any other shape.
 */
export interface TextShape {
  readonly kind: 'text';
  /** text center point */
  readonly anchor: Point;
  readonly text: string;
  /** cap height in world units */
  readonly height: number;
  /** radians, counter-clockwise from +x */
  readonly rotation: number;
}

export type Geometry =
  | SegmentShape
  | PolylineShape
  | CircleShape
  | ArcShape
  | RegionShape
  | GroupShape
  | TextShape;

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
    case 'text': {
      // no font metrics in core — estimate half-width from glyph count
      const r = Math.max((g.text.length * g.height * 0.7) / 2, g.height);
      return {
        minX: g.anchor.x - r,
        minY: g.anchor.y - r,
        maxX: g.anchor.x + r,
        maxY: g.anchor.y + r,
      };
    }
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

/**
 * Apply a similarity transform (translate/rotate/uniform scale) to a geometry.
 * Circles and arcs assume uniform scale — sufficient for move/rotate/copy.
 */
export function transformGeometry(g: Geometry, m: Matrix3): Geometry {
  switch (g.kind) {
    case 'segment':
      return {
        kind: 'segment',
        a: applyToPoint(m, g.a),
        b: applyToPoint(m, g.b),
      };
    case 'polyline':
      return {
        kind: 'polyline',
        points: g.points.map((p) => applyToPoint(m, p)),
        closed: g.closed,
      };
    case 'circle':
      return {
        kind: 'circle',
        center: applyToPoint(m, g.center),
        radius: g.radius * length(applyToVector(m, { x: 1, y: 0 })),
      };
    case 'arc': {
      const rotation = angleOf(applyToVector(m, { x: 1, y: 0 }));
      return {
        kind: 'arc',
        center: applyToPoint(m, g.center),
        radius: g.radius * length(applyToVector(m, { x: 1, y: 0 })),
        startAngle: g.startAngle + rotation,
        endAngle: g.endAngle + rotation,
      };
    }
    case 'region':
      return {
        kind: 'region',
        boundary: g.boundary.map((p) => applyToPoint(m, p)),
        holes: g.holes.map((hole) => hole.map((p) => applyToPoint(m, p))),
      };
    case 'text':
      return {
        kind: 'text',
        anchor: applyToPoint(m, g.anchor),
        text: g.text,
        height: g.height * length(applyToVector(m, { x: 1, y: 0 })),
        rotation: g.rotation + angleOf(applyToVector(m, { x: 1, y: 0 })),
      };
    case 'group':
      return {
        kind: 'group',
        children: g.children.map((c) => transformGeometry(c, m)),
      };
  }
}
