import type { Point } from '../geometry/primitives/point.js';
import { add, angleOf, cross, distance, dot, lerp, scale, sub } from '../geometry/primitives/point.js';
import { closestPointOnSegment } from '../geometry/curves/segment.js';

/**
 * Planar arrangement of wall baselines — the substrate for space (room)
 * detection. Segments are split at every touch point: endpoint-endpoint
 * corners, endpoint-on-body tees at ANY parameter along the host, and proper
 * X crossings. Faces of the resulting planar graph are the enclosed regions.
 * Pure math over id'd segments — never sees entities, like junctions.ts.
 * See docs/editor-core/04-systems/spaces.md.
 */
export interface ArrangementSegment {
  readonly id: string;
  readonly a: Point;
  readonly b: Point;
  /**
   * Body half-width for tee attachment: an endpoint within
   * halfWidth + tolerance of this segment's interior snaps onto it, so a
   * wall drawn flush to a host's FACE connects like one drawn to its
   * centerline. 0 (default) = exact touches only.
   */
  readonly halfWidth?: number;
}

/** One face boundary edge, oriented so the face interior is on the LEFT. */
export interface FaceEdge {
  readonly segmentId: string;
  readonly a: Point;
  readonly b: Point;
}

export interface ArrangementFace {
  /** boundary vertices, counter-clockwise; dangling stubs appear as spikes */
  readonly loop: readonly Point[];
  readonly edges: readonly FaceEdge[];
  /** enclosed area with island holes subtracted */
  readonly area: number;
  /** contours of detached islands lying fully inside this face */
  readonly holes: readonly (readonly Point[])[];
}

/** shoelace signed area — positive for counter-clockwise loops */
export function loopSignedArea(points: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
}

/** ray-cast point-in-polygon; boundary points are undefined territory */
export function pointInLoop(p: Point, loop: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
    const a = loop[i];
    const b = loop[j];
    if (a.y > p.y !== b.y > p.y) {
      const x = a.x + ((p.y - a.y) / (b.y - a.y)) * (b.x - a.x);
      if (p.x < x) inside = !inside;
    }
  }
  return inside;
}

interface Working {
  readonly id: string;
  a: Point;
  b: Point;
  readonly halfWidth: number;
  readonly splits: Point[];
}

interface HalfEdge {
  readonly from: number;
  readonly to: number;
  readonly segmentId: string;
  readonly twin: number;
  readonly angle: number;
}

/**
 * Build the arrangement and extract its bounded faces. The unbounded face is
 * dropped; detached-island contours become holes of the face containing them.
 * Discovery reads baselines only (the wall-joins invariant): nothing here
 * depends on derived face geometry.
 */
export function arrangeSegments(
  segments: readonly ArrangementSegment[],
  tolerance: number,
): ArrangementFace[] {
  const working: Working[] = [];
  for (const s of segments) {
    if (distance(s.a, s.b) <= tolerance) continue;
    working.push({ id: s.id, a: s.a, b: s.b, halfWidth: s.halfWidth ?? 0, splits: [] });
  }

  // tee snapping: an endpoint near a host's body snaps onto it and splits it
  // there — at any parameter, matching WallEntity.teeCap (nearest host wins,
  // host endpoints excluded: those are corner joins handled by clustering)
  for (const seg of working) {
    for (const which of ['a', 'b'] as const) {
      const p = seg[which];
      let best: { host: Working; foot: Point; dist: number } | null = null;
      for (const host of working) {
        if (host === seg) continue;
        const foot = closestPointOnSegment(p, host.a, host.b);
        const d = distance(p, foot);
        if (d > host.halfWidth + tolerance) continue;
        if (distance(foot, host.a) <= tolerance || distance(foot, host.b) <= tolerance) continue;
        if (best === null || d < best.dist) best = { host, foot, dist: d };
      }
      if (best) {
        seg[which] = best.foot;
        best.host.splits.push(best.foot);
      }
    }
  }

  // proper X crossings split both segments (runs on tee-snapped geometry)
  for (let i = 0; i < working.length; i++) {
    for (let j = i + 1; j < working.length; j++) {
      const A = working[i];
      const B = working[j];
      const r = sub(A.b, A.a);
      const s = sub(B.b, B.a);
      const denom = cross(r, s);
      if (Math.abs(denom) < 1e-12) continue; // parallel/collinear overlap: dedup'd later
      const qp = sub(B.a, A.a);
      const t = cross(qp, s) / denom;
      const u = cross(qp, r) / denom;
      const tMargin = tolerance / distance(A.a, A.b);
      const uMargin = tolerance / distance(B.a, B.b);
      if (t <= tMargin || t >= 1 - tMargin || u <= uMargin || u >= 1 - uMargin) continue;
      const pt = add(A.a, scale(r, t));
      A.splits.push(pt);
      B.splits.push(pt);
    }
  }

  // split into pieces at collected points (deduped along the segment)
  const pieces: { id: string; a: Point; b: Point }[] = [];
  for (const seg of working) {
    const ab = sub(seg.b, seg.a);
    const len = distance(seg.a, seg.b);
    const lenSq = dot(ab, ab);
    const raw = seg.splits
      .map((p) => dot(sub(p, seg.a), ab) / lenSq)
      .filter((t) => t * len > tolerance && (1 - t) * len > tolerance)
      .sort((x, y) => x - y);
    const ts: number[] = [0];
    for (const t of raw) {
      if ((t - ts[ts.length - 1]) * len > tolerance) ts.push(t);
    }
    ts.push(1);
    for (let i = 1; i < ts.length; i++) {
      const a = ts[i - 1] === 0 ? seg.a : lerp(seg.a, seg.b, ts[i - 1]);
      const b = ts[i] === 1 ? seg.b : lerp(seg.a, seg.b, ts[i]);
      pieces.push({ id: seg.id, a, b });
    }
  }

  // cluster piece endpoints into graph nodes
  const nodes: Point[] = [];
  const nodeOf = (p: Point): number => {
    for (let i = 0; i < nodes.length; i++) {
      if (distance(nodes[i], p) <= tolerance) return i;
    }
    nodes.push(p);
    return nodes.length - 1;
  };
  const edgeKeys = new Set<string>();
  const edges: { u: number; v: number; segmentId: string }[] = [];
  for (const piece of pieces) {
    const u = nodeOf(piece.a);
    const v = nodeOf(piece.b);
    if (u === v) continue;
    const key = u < v ? `${u}:${v}` : `${v}:${u}`;
    if (edgeKeys.has(key)) continue; // overlapping collinear duplicates
    edgeKeys.add(key);
    edges.push({ u, v, segmentId: piece.id });
  }

  // connected components — holes can only come from a DIFFERENT component
  // (within one component the face walk traverses around islands via bridges)
  const comp = new Array<number>(nodes.length).fill(-1);
  const adjacency = new Map<number, number[]>();
  const addAdjacent = (from: number, to: number): void => {
    const list = adjacency.get(from);
    if (list) list.push(to);
    else adjacency.set(from, [to]);
  };
  for (const e of edges) {
    addAdjacent(e.u, e.v);
    addAdjacent(e.v, e.u);
  }
  let compCount = 0;
  for (let n = 0; n < nodes.length; n++) {
    if (comp[n] !== -1 || !adjacency.has(n)) continue;
    const stack = [n];
    comp[n] = compCount;
    while (stack.length > 0) {
      const cur = stack.pop()!;
      for (const next of adjacency.get(cur) ?? []) {
        if (comp[next] === -1) {
          comp[next] = compCount;
          stack.push(next);
        }
      }
    }
    compCount++;
  }

  // half-edge structure: outgoing edges per node, sorted by angle
  const halves: HalfEdge[] = [];
  for (const e of edges) {
    const d = sub(nodes[e.v], nodes[e.u]);
    const i0 = halves.length;
    halves.push({ from: e.u, to: e.v, segmentId: e.segmentId, twin: i0 + 1, angle: angleOf(d) });
    halves.push({
      from: e.v,
      to: e.u,
      segmentId: e.segmentId,
      twin: i0,
      angle: angleOf(scale(d, -1)),
    });
  }
  const outgoing = new Map<number, number[]>();
  for (let i = 0; i < halves.length; i++) {
    const list = outgoing.get(halves[i].from);
    if (list) list.push(i);
    else outgoing.set(halves[i].from, [i]);
  }
  const posInNode = new Array<number>(halves.length).fill(0);
  for (const list of outgoing.values()) {
    list.sort((x, y) => halves[x].angle - halves[y].angle);
    for (let k = 0; k < list.length; k++) posInNode[list[k]] = k;
  }
  // leftmost-turn rule: continue with the clockwise-next edge from the
  // reverse direction — traces every face once, interior on the left
  const nextOf = (hi: number): number => {
    const list = outgoing.get(halves[hi].to)!;
    const k = posInNode[halves[hi].twin];
    return list[(k - 1 + list.length) % list.length];
  };

  // walk all cycles; positive area = bounded face, negative = outer contour
  const areaEps = tolerance * tolerance;
  interface MutableFace {
    loop: Point[];
    edges: FaceEdge[];
    area: number;
    loopArea: number;
    component: number;
    holes: Point[][];
  }
  const faces: MutableFace[] = [];
  const outers: { loop: Point[]; area: number; component: number }[] = [];
  const visited = new Array<boolean>(halves.length).fill(false);
  for (let hi = 0; hi < halves.length; hi++) {
    if (visited[hi]) continue;
    const cycle: number[] = [];
    let cur = hi;
    while (!visited[cur]) {
      visited[cur] = true;
      cycle.push(cur);
      cur = nextOf(cur);
    }
    const loop = cycle.map((h) => nodes[halves[h].from]);
    const area = loopSignedArea(loop);
    if (area > areaEps) {
      faces.push({
        loop,
        edges: cycle.map((h) => ({
          segmentId: halves[h].segmentId,
          a: nodes[halves[h].from],
          b: nodes[halves[h].to],
        })),
        area,
        loopArea: area,
        component: comp[halves[hi].from],
        holes: [],
      });
    } else if (area < -areaEps) {
      outers.push({ loop, area: -area, component: comp[halves[hi].from] });
    }
    // |area| ≤ eps: a lone stub's out-and-back cycle — not a face
  }

  // a detached component's outer contour is a hole of whichever foreign
  // face contains it; smallest containing face wins (deepest nesting)
  const byLoopArea = [...faces].sort((x, y) => x.loopArea - y.loopArea);
  for (const outer of outers) {
    const rep = outer.loop[0];
    for (const face of byLoopArea) {
      if (face.component === outer.component) continue;
      if (!pointInLoop(rep, face.loop)) continue;
      face.holes.push(outer.loop);
      face.area -= outer.area;
      break;
    }
  }

  return faces.map((f) => ({
    loop: f.loop,
    edges: f.edges,
    area: f.area,
    holes: f.holes,
  }));
}
