import type { EntityId, LevelId } from '../common/id.js';
import type { Point } from '../geometry/primitives/point.js';
import { add, distance, normalize, perpendicular, scale, sub } from '../geometry/primitives/point.js';
import type { DrawingDocument } from '../document/document.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import type { ArrangementSegment, FaceEdge } from '../topology/arrangement.js';
import { arrangePlan, arrangeSegments, loopSignedArea, pointInLoop } from '../topology/arrangement.js';
import { JOIN_TOLERANCE, intersectLines } from '../topology/junctions.js';

/**
 * A detected space (room): a bounded region of the wall arrangement.
 * Derived on every read, never stored — move a wall and the rooms change on
 * the next call; there is no space entity and no cache on the document.
 * See docs/editor-core/04-systems/spaces.md.
 */
export interface SpaceInfo {
  /** centroid-derived identity (`s@x,y` at 0.1 m) — best-effort stability */
  readonly key: string;
  readonly levelId: LevelId | null;
  /** net room polygon along inner wall faces — what finishes and schedules want */
  readonly boundary: readonly Point[];
  /** gross polygon along wall centerlines — consistent with wall takeoff */
  readonly grossBoundary: readonly Point[];
  readonly netArea: number;
  readonly grossArea: number;
  readonly boundaryWallIds: readonly EntityId[];
  /** which wall face looks INTO the room — what FINISH.AUTO tiles */
  readonly boundaryFaces: readonly { readonly wallId: EntityId; readonly side: 'face+' | 'face-' }[];
  /** contours of detached wall islands inside the room (gross, centerline) */
  readonly holes: readonly (readonly Point[])[];
  /** a point inside the net boundary — where a label belongs */
  readonly labelPoint: Point;
}

/** faces smaller than this are arrangement slivers, not rooms */
const MIN_SPACE_AREA = 0.01;

/** net corners sharper than this clamp to a jog, mirroring the miter limit */
const MITER_LIMIT = 8;

/**
 * Offset a boundary loop edge by edge: positive offsets move toward the
 * LEFT of each edge (the interior side), negative outward. Consecutive
 * offset lines intersect at corners; parallel or miter-limit-breaking
 * neighbors connect with a jog across the shared node (a dangling stub
 * gets a squared notch this way). Serves rooms pulled in to inner faces
 * AND outlines pushed out to eaves.
 */
export function offsetBoundary(
  edges: readonly FaceEdge[],
  offsetOf: (segmentId: string) => number,
): Point[] {
  const n = edges.length;
  const points: Point[] = [];
  for (let k = 0; k < n; k++) {
    const e = edges[k];
    const f = edges[(k + 1) % n];
    const de = normalize(sub(e.b, e.a));
    const df = normalize(sub(f.b, f.a));
    const distE = offsetOf(e.segmentId);
    const distF = offsetOf(f.segmentId);
    const offE = scale(perpendicular(de), distE);
    const offF = scale(perpendicular(df), distF);
    const node = e.b;
    const corner = intersectLines(add(e.a, offE), de, add(f.a, offF), df);
    if (
      corner &&
      distance(corner, node) <= MITER_LIMIT * Math.max(Math.abs(distE), Math.abs(distF))
    ) {
      points.push(corner);
      continue;
    }
    const p1 = add(node, offE);
    const p2 = add(node, offF);
    points.push(p1);
    if (distance(p1, p2) > JOIN_TOLERANCE) points.push(p2);
  }
  return points;
}

/** area-weighted polygon centroid; falls back to the first vertex */
function loopCentroid(points: readonly Point[]): Point {
  let area = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const w = p.x * q.y - q.x * p.y;
    area += w;
    cx += (p.x + q.x) * w;
    cy += (p.y + q.y) * w;
  }
  if (Math.abs(area) < 1e-12) return points[0];
  return { x: cx / (3 * area), y: cy / (3 * area) };
}

/**
 * A point inside the loop (outside its holes). The centroid when it lands
 * inside — an L-shaped room's centroid can fall outside, then the widest gap
 * of a horizontal scanline through the centroid wins.
 */
function interiorPoint(loop: readonly Point[], holes: readonly (readonly Point[])[]): Point {
  const c = loopCentroid(loop);
  const isInside = (p: Point): boolean =>
    pointInLoop(p, loop) && !holes.some((hole) => pointInLoop(p, hole));
  if (isInside(c)) return c;
  const xs: number[] = [];
  for (const ring of [loop, ...holes]) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i];
      const b = ring[j];
      if (a.y > c.y !== b.y > c.y) {
        xs.push(a.x + ((c.y - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
  }
  xs.sort((x, y) => x - y);
  let best = c;
  let bestGap = 0;
  for (let i = 0; i + 1 < xs.length; i += 2) {
    if (xs[i + 1] - xs[i] > bestGap) {
      bestGap = xs[i + 1] - xs[i];
      best = { x: (xs[i] + xs[i + 1]) / 2, y: c.y };
    }
  }
  return best;
}

/**
 * Detect spaces bounded by walls on a level. Walls are collected the way
 * plan views query (level-unassigned walls bound rooms on every level;
 * `levelId: null` = all walls); layer visibility is ignored — spaces are a
 * model fact, like quantities. Free function by design: derived on read,
 * no cache on the document.
 */
function collectWallSegments(
  doc: DrawingDocument,
  levelId: LevelId | null,
): { walls: Map<string, WallEntity>; segments: ArrangementSegment[] } {
  const walls = new Map<string, WallEntity>();
  const segments: ArrangementSegment[] = [];
  for (const entity of doc.all()) {
    if (!(entity instanceof WallEntity)) continue;
    if (levelId !== null && entity.baseLevelId !== null && entity.baseLevelId !== levelId) continue;
    const { a, b } = entity.getBaseline();
    walls.set(entity.id as string, entity);
    segments.push({ id: entity.id as string, a, b, halfWidth: entity.getThickness() / 2 });
  }
  return { walls, segments };
}

export function detectSpaces(doc: DrawingDocument, levelId: LevelId | null): SpaceInfo[] {
  const { walls, segments } = collectWallSegments(doc, levelId);

  const halfWidthOf = (id: string): number => {
    const wall = walls.get(id);
    return wall ? wall.getThickness() / 2 : 0;
  };

  const spaces: SpaceInfo[] = [];
  for (const face of arrangeSegments(segments, JOIN_TOLERANCE)) {
    if (face.area < MIN_SPACE_AREA) continue;
    const net = offsetBoundary(face.edges, halfWidthOf);
    const holeArea = face.holes.reduce((sum, hole) => sum + Math.abs(loopSignedArea(hole)), 0);
    const netArea = Math.max(0, Math.abs(loopSignedArea(net)) - holeArea);
    const wallIds: EntityId[] = [];
    const boundaryFaces: { wallId: EntityId; side: 'face+' | 'face-' }[] = [];
    for (const edge of face.edges) {
      const id = edge.segmentId as EntityId;
      if (wallIds.includes(id)) continue;
      wallIds.push(id);
      // edges run interior-on-the-left; the room-facing wall face is the one
      // whose +normal (baseline direction) agrees with the edge direction
      const wall = walls.get(id as string);
      if (!wall) continue;
      const bl = wall.getBaseline();
      const wallDir = normalize(sub(bl.b, bl.a));
      const edgeDir = normalize(sub(edge.b, edge.a));
      const dot = wallDir.x * edgeDir.x + wallDir.y * edgeDir.y;
      boundaryFaces.push({ wallId: id, side: dot >= 0 ? 'face+' : 'face-' });
    }
    const centroid = loopCentroid(face.loop);
    spaces.push({
      key: `s@${centroid.x.toFixed(1)},${centroid.y.toFixed(1)}`,
      levelId,
      boundary: net,
      grossBoundary: face.loop,
      netArea,
      grossArea: face.area,
      boundaryWallIds: wallIds,
      boundaryFaces,
      holes: face.holes,
      labelPoint: interiorPoint(net, face.holes),
    });
  }
  spaces.sort((a, b) => b.netArea - a.netArea || (a.key < b.key ? -1 : 1));
  return spaces;
}

/** the outer contour of a connected run of walls — what a roof covers */
export interface OutlineInfo {
  /** outer contour along wall centerlines, counter-clockwise */
  readonly grossBoundary: readonly Point[];
  /** contour pushed out to the outer wall faces */
  readonly boundary: readonly Point[];
  readonly boundaryWallIds: readonly EntityId[];
  /** oriented edges (building on the left) for custom offsets — eaves lines */
  readonly edges: readonly FaceEdge[];
}

/**
 * Building outlines per connected component of walls on a level — the
 * arrangement's outer contours, derived on read like everything else here.
 * ROOF.AUTO and outer dimension chains consume these.
 */
export function detectOutlines(doc: DrawingDocument, levelId: LevelId | null): OutlineInfo[] {
  const { walls, segments } = collectWallSegments(doc, levelId);
  const halfWidthOf = (id: string): number => {
    const wall = walls.get(id);
    return wall ? wall.getThickness() / 2 : 0;
  };
  const outlines: OutlineInfo[] = [];
  for (const edges of arrangePlan(segments, JOIN_TOLERANCE).outlines) {
    const wallIds: EntityId[] = [];
    for (const edge of edges) {
      const id = edge.segmentId as EntityId;
      if (!wallIds.includes(id)) wallIds.push(id);
    }
    outlines.push({
      grossBoundary: edges.map((e) => e.a),
      // building is on the LEFT of outline edges — negative offsets go out
      boundary: offsetBoundary(edges, (id) => -halfWidthOf(id)),
      boundaryWallIds: wallIds,
      edges,
    });
  }
  return outlines;
}
