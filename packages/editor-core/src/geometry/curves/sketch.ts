import type { Point } from '../primitives/point.js';
import { distanceToSegment } from './segment.js';

/**
 * Freehand → clean geometry. The pen produces a noisy stream of points; these
 * pure functions turn each stroke into the few straight segments the drafter
 * actually meant, snapped so corners meet and near-axis runs read true. No
 * document, no entities — the caller (a tool) maps the segments onto WALL.ADD.
 */

export interface WallSegment {
  a: Point;
  b: Point;
}

export interface RecognizeWallsOptions {
  /** Douglas–Peucker tolerance in meters — how far ink may bow before it counts as a corner (default 0.15). */
  simplifyTolerance?: number;
  /** endpoints within this many meters weld into one shared corner (default 0.35). */
  snapTolerance?: number;
  /** segments shorter than this (meters) are dropped as stray flicks (default 0.25). */
  minLength?: number;
  /**
   * Straighten bias, in degrees. A stroke tilted within this angle of the
   * nearest axis is forced perfectly horizontal or vertical — because a hand
   * never draws straight. Only a stroke tilted MORE than this (toward the
   * 45° diagonal) is kept at its drawn angle (default 35).
   */
  axisSnapDegrees?: number;
  /**
   * Corner threshold, in degrees. Where a stroke bends by LESS than this it's
   * treated as one wavering line, not a corner, and the interior point is
   * dropped — so a line drawn with a belly stays a single wall instead of
   * splitting into collinear pieces. Only bends sharper than this survive as
   * real corners (default 35).
   */
  cornerDegrees?: number;
  /**
   * Square-up window, in degrees. A corner that lands within this many degrees
   * of a right angle is turned into exactly 90° — a hand aiming at square
   * misses by a few degrees, and 93° is 93° wrong in every room, quantity and
   * elevation downstream. Set to 0 to leave corners exactly as drawn
   * (default 5).
   */
  squareDegrees?: number;
}

const DEFAULTS: Required<RecognizeWallsOptions> = {
  simplifyTolerance: 0.15,
  snapTolerance: 0.35,
  minLength: 0.25,
  axisSnapDegrees: 35,
  cornerDegrees: 35,
  squareDegrees: 5,
};

/** drop points closer than eps to their predecessor — a pen dwelling in place */
function dedupeConsecutive(points: readonly Point[], eps: number): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (!last || Math.hypot(p.x - last.x, p.y - last.y) > eps) out.push(p);
  }
  return out;
}

/**
 * Ramer–Douglas–Peucker: keep the points that carry the stroke's shape, drop
 * the ones that only sample a straight run. Returns a new array; leaves the
 * first and last point in place.
 */
export function simplifyStroke(
  points: readonly Point[],
  tolerance: number,
): Point[] {
  const pts = dedupeConsecutive(points, tolerance * 0.25);
  if (pts.length <= 2) return pts;

  const keep = new Array<boolean>(pts.length).fill(false);
  keep[0] = true;
  keep[pts.length - 1] = true;

  // iterative RDP (an explicit stack, so a long stroke can't blow the call stack)
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let maxDist = -1;
    let idx = -1;
    for (let i = lo + 1; i < hi; i++) {
      const d = distanceToSegment(pts[i], pts[lo], pts[hi]);
      if (d > maxDist) {
        maxDist = d;
        idx = i;
      }
    }
    if (maxDist > tolerance && idx > lo) {
      keep[idx] = true;
      stack.push([lo, idx], [idx, hi]);
    }
  }

  return pts.filter((_, i) => keep[i]);
}

/** signed turn at b between a→b and b→c, in degrees (0 = straight through) */
function turnDegrees(a: Point, b: Point, c: Point): number {
  const v1x = b.x - a.x;
  const v1y = b.y - a.y;
  const v2x = c.x - b.x;
  const v2y = c.y - b.y;
  const cross = v1x * v2y - v1y * v2x;
  const dot = v1x * v2x + v1y * v2y;
  return (Math.abs(Math.atan2(cross, dot)) * 180) / Math.PI;
}

/**
 * Drop interior points where the stroke barely bends: a hand-drawn "straight"
 * line has a belly, and RDP keeps its apex, which would otherwise split the
 * line into two collinear walls. Bends sharper than `cornerDegrees` are real
 * corners and survive. The retained previous point anchors the run, so a gentle
 * arc collapses to one segment rather than a staircase.
 */
function mergeCollinear(
  points: readonly Point[],
  cornerDegrees: number,
): Point[] {
  if (points.length <= 2) return [...points];
  const out: Point[] = [points[0]];
  for (let i = 1; i < points.length - 1; i++) {
    const prev = out[out.length - 1];
    if (turnDegrees(prev, points[i], points[i + 1]) >= cornerDegrees) {
      out.push(points[i]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** the drawn orientation of a segment: horizontal, vertical, or a kept diagonal */
type Axis = 'h' | 'v' | null;

/**
 * Classify a segment by its DRAWN angle. Anything within `snapDegrees` of an
 * axis is that axis (a hand can't draw straight); only the remaining wedge
 * around 45° is treated as an intentional diagonal.
 */
function classifyAxis(a: Point, b: Point, snapDegrees: number): Axis {
  const deg =
    (Math.atan2(Math.abs(b.y - a.y), Math.abs(b.x - a.x)) * 180) / Math.PI; // 0..90 from horizontal
  if (deg <= snapDegrees) return 'h';
  if (deg >= 90 - snapDegrees) return 'v';
  return null;
}

/** minimal union-find over node indices, for grouping shared coordinates */
class UnionFind {
  private parent: number[];
  constructor(n: number) {
    this.parent = Array.from({ length: n }, (_, i) => i);
  }
  find(i: number): number {
    while (this.parent[i] !== i) {
      this.parent[i] = this.parent[this.parent[i]];
      i = this.parent[i];
    }
    return i;
  }
  union(a: number, b: number): void {
    this.parent[this.find(a)] = this.find(b);
  }
}

/** collapse each group to its mean coordinate — makes axis-aligned walls exact */
function averageGroups(
  nodes: { x: number; y: number }[],
  uf: UnionFind,
  key: 'x' | 'y',
): void {
  const sum = new Map<number, { total: number; count: number }>();
  for (let i = 0; i < nodes.length; i++) {
    const root = uf.find(i);
    const acc = sum.get(root) ?? { total: 0, count: 0 };
    acc.total += nodes[i][key];
    acc.count++;
    sum.set(root, acc);
  }
  for (let i = 0; i < nodes.length; i++) {
    const acc = sum.get(uf.find(i))!;
    nodes[i][key] = acc.total / acc.count;
  }
}

/**
 * Pull nearly-right corners onto exactly 90°.
 *
 * Which corners are those? Not the obvious ones. Straightening has already made
 * every corner between two axis-classified legs exactly square, and a leg
 * cannot come within `squareDegrees` of perpendicular to an axis leg without
 * classifying to the perpendicular axis itself — `squareDegrees` is the smaller
 * window. So the corners left over are the ones where BOTH legs were drawn
 * clearly diagonal: a room drawn at a slant, where nothing has been forced true
 * and a 93° corner stays 93°.
 *
 * Rotating a leg about its corner moves its FAR node, and that node may anchor
 * other walls — turn one leg and the rest of the shape has to follow, which is
 * how a closed loop comes apart. So a leg turns only when nothing depends on
 * where it ends (its far node carries no other segment), and only when it is a
 * diagonal, because turning an axis-classified leg would undo the straightening
 * that just made it true. Both ends free, each takes half the error; one end
 * free, it takes all of it; neither, the corner stays as drawn — a corner is
 * not worth breaking the room it belongs to. In a closed loop no end is free,
 * so a loop can never be pulled apart here.
 */
function squareCorners(
  nodes: { x: number; y: number }[],
  segs: readonly { i: number; j: number; axis: Axis }[],
  squareDegrees: number,
): void {
  const incident: number[][] = nodes.map(() => []);
  for (let s = 0; s < segs.length; s++) {
    incident[segs[s].i].push(s);
    incident[segs[s].j].push(s);
  }

  // a free end that has already turned is spent: turning it again for the next
  // corner would un-square the one it was just moved for
  const spent = new Set<number>();
  const farNode = (s: number, at: number): number =>
    segs[s].i === at ? segs[s].j : segs[s].i;
  /** the node this leg may swing, or null if the leg has to stay as drawn */
  const swingable = (s: number, at: number): number | null => {
    if (segs[s].axis !== null) return null;
    const far = farNode(s, at);
    return incident[far].length === 1 && !spent.has(far) ? far : null;
  };
  const swing = (n: number, at: number, degrees: number): void => {
    const rad = (degrees * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const dx = nodes[n].x - nodes[at].x;
    const dy = nodes[n].y - nodes[at].y;
    nodes[n].x = nodes[at].x + dx * cos - dy * sin;
    nodes[n].y = nodes[at].y + dx * sin + dy * cos;
    spent.add(n);
  };

  for (let at = 0; at < nodes.length; at++) {
    const legs = incident[at];
    for (let p = 0; p < legs.length; p++) {
      for (let q = p + 1; q < legs.length; q++) {
        const n1 = farNode(legs[p], at);
        const n2 = farNode(legs[q], at);
        const ux = nodes[n1].x - nodes[at].x;
        const uy = nodes[n1].y - nodes[at].y;
        const vx = nodes[n2].x - nodes[at].x;
        const vy = nodes[n2].y - nodes[at].y;
        // signed, so the correction knows which way the corner has to turn
        const between =
          (Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy) * 180) / Math.PI;
        const error = Math.abs(between) - 90;
        if (Math.abs(error) > squareDegrees || Math.abs(error) < 1e-9) continue;
        // turning the second leg by this much opens (or closes) the corner to 90°
        const correction = -error * Math.sign(between);
        const first = swingable(legs[p], at);
        const second = swingable(legs[q], at);
        if (first !== null && second !== null) {
          swing(first, at, -correction / 2);
          swing(second, at, correction / 2);
        } else if (second !== null) {
          swing(second, at, correction);
        } else if (first !== null) {
          swing(first, at, -correction);
        }
      }
    }
  }
}

/**
 * Turn freehand strokes into clean wall segments. Each stroke is simplified,
 * its vertices are welded into shared corner nodes, and every segment is
 * straightened to horizontal or vertical UNLESS it was drawn clearly
 * diagonal (see `axisSnapDegrees`). Shared coordinates are then averaged so
 * axis-aligned walls are geometrically exact and joined corners line up — a
 * wobbly hand-drawn rectangle comes back as four square walls sharing exact
 * corners, ready for WALL.ADD and room detection, while a real diagonal wall
 * keeps its slope. Corners that survive all that still nearly square are
 * finally turned onto exactly 90° (see `squareDegrees`), which is what a room
 * drawn at a slant needs.
 */
export function recognizeWalls(
  strokes: readonly (readonly Point[])[],
  options: RecognizeWallsOptions = {},
): WallSegment[] {
  const {
    simplifyTolerance,
    snapTolerance,
    minLength,
    axisSnapDegrees,
    cornerDegrees,
    squareDegrees,
  } = { ...DEFAULTS, ...options };

  // simplify, then fold each wavering-but-straight run back into one segment
  const simplified = strokes
    .map((s) =>
      mergeCollinear(simplifyStroke(s, simplifyTolerance), cornerDegrees),
    )
    .filter((s) => s.length >= 2);
  if (simplified.length === 0) return [];

  // 1) weld vertices into shared corner nodes (running-average position)
  const nodes: { x: number; y: number; n: number }[] = [];
  const nodeIndex = (p: Point): number => {
    for (let i = 0; i < nodes.length; i++) {
      const nd = nodes[i];
      if (Math.hypot(p.x - nd.x, p.y - nd.y) <= snapTolerance) {
        nd.x = (nd.x * nd.n + p.x) / (nd.n + 1);
        nd.y = (nd.y * nd.n + p.y) / (nd.n + 1);
        nd.n++;
        return i;
      }
    }
    nodes.push({ x: p.x, y: p.y, n: 1 });
    return nodes.length - 1;
  };

  // 2) build unique segments as node pairs, tagged by their DRAWN orientation
  const segs: { i: number; j: number; axis: Axis }[] = [];
  const seen = new Set<string>();
  for (const stroke of simplified) {
    const idx = stroke.map(nodeIndex);
    for (let k = 1; k < idx.length; k++) {
      const i = idx[k - 1];
      const j = idx[k];
      if (i === j) continue;
      const key = i < j ? `${i}-${j}` : `${j}-${i}`;
      if (seen.has(key)) continue;
      seen.add(key);
      segs.push({
        i,
        j,
        axis: classifyAxis(stroke[k - 1], stroke[k], axisSnapDegrees),
      });
    }
  }

  // 3) straighten: vertical walls force a shared X, horizontal a shared Y;
  //    averaging each group snaps those walls perfectly true and keeps
  //    corners meeting. Diagonal walls impose no constraint — they follow
  //    wherever their welded corners land.
  const xuf = new UnionFind(nodes.length);
  const yuf = new UnionFind(nodes.length);
  for (const s of segs) {
    if (s.axis === 'v') xuf.union(s.i, s.j);
    if (s.axis === 'h') yuf.union(s.i, s.j);
  }
  averageGroups(nodes, xuf, 'x');
  averageGroups(nodes, yuf, 'y');

  // 4) drop stray flicks BEFORE squaring, so a stub that will never be a wall
  //    neither pins a node nor gets a real wall squared onto it. Swinging a leg
  //    about its corner keeps its length, so nothing here changes afterwards.
  const kept = segs.filter(
    (s) =>
      Math.hypot(nodes[s.j].x - nodes[s.i].x, nodes[s.j].y - nodes[s.i].y) >=
      minLength,
  );

  // 5) square the near-right corners straightening could not reach — the ones
  //    between two diagonals, which no axis was ever forced on
  if (squareDegrees > 0) squareCorners(nodes, kept, squareDegrees);

  // 6) emit segments from final node positions
  return kept.map((s) => ({
    a: { x: nodes[s.i].x, y: nodes[s.i].y },
    b: { x: nodes[s.j].x, y: nodes[s.j].y },
  }));
}
