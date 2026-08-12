import type {
  EntityId,
  Geometry,
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
  WallSegment,
} from '@acip/editor-core';
import { recognizeWalls } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/**
 * Ink samples closer together than this (meters) are dropped as the finger
 * dwelling in place. A phone fires pointermove far faster than a hand moves,
 * and every sample kept is one more point to re-recognize on the next one.
 */
const MIN_SAMPLE = 0.02;

/**
 * How near an existing corner a recognized end has to land to be welded onto
 * it, in meters.
 *
 * The same radius the recognizer welds a stroke's OWN corners with, so the pen
 * has one reach in and out: a hand that draws two ends together means them
 * together, whether the other end belongs to this stroke or to the plan it is
 * being drawn against. It is tighter than the wall tool's touch snap (24 px,
 * about half a meter at a normal zoom), so this welds less eagerly than
 * tapping a wall into place does.
 */
const WELD_TOLERANCE = 0.35;

/**
 * Two recognized corners are the same corner when their coordinates match. The
 * recognizer emits a shared corner as one node's coordinates twice, so this is
 * exact; the rounding is only there so it stays exact if that ever stops being
 * bit-for-bit true.
 */
const cornerKey = (p: Point): string =>
  `${Math.round(p.x * 1e6)}:${Math.round(p.y * 1e6)}`;

/**
 * Weld a recognized shape onto the plan it was drawn against — without tilting
 * what the recognizer just made straight.
 *
 * Welding moves endpoints, and moving ONE end of a wall pivots it about the
 * other. On a 5 m wall a 3 cm weld is a lean of 0.11°, invisible. But a 1.4 m
 * wall welded 32 cm sideways comes out 8.2° off vertical, and 8° is not a
 * wobble — the recognizer had made that wall exactly vertical, and the weld
 * undid it, along with everything that follows from a wall being axis-true: the
 * square corner at its far end, the through-run at its junction, the length
 * that reads as a round number.
 *
 * So a shape with exactly ONE end to weld is not pivoted, it is SLID: every
 * corner of it moves by the same vector. Angles, lengths and shared corners
 * survive untouched, the welded end still lands exactly on its target, and the
 * price is that the far end moves — by at most the weld reach, a hand's width,
 * which is the same imprecision welding exists to forgive in the first place.
 *
 * A shape with two or more ends to weld cannot be slid onto both, and should
 * not be: two anchors mean the plan decides where that wall runs, not the hand.
 * Those weld corner by corner, exactly as before — which is what a room drawn
 * under another room is, and how it keeps sharing the wall between them.
 */
function weldOntoPlan(
  segments: readonly WallSegment[],
  weld: (p: Point) => Point,
): WallSegment[] {
  const index = new Map<string, number>();
  const corners: Point[] = [];
  const idOf = (p: Point): number => {
    const key = cornerKey(p);
    const found = index.get(key);
    if (found !== undefined) return found;
    index.set(key, corners.length);
    corners.push(p);
    return corners.length - 1;
  };
  const pairs = segments.map((s) => [idOf(s.a), idOf(s.b)] as const);

  // one shape is one connected run of segments, and what slides slides whole
  const parent = corners.map((_, i) => i);
  const find = (i: number): number => {
    while (parent[i] !== i) i = parent[i] = parent[parent[i]];
    return i;
  };
  for (const [i, j] of pairs) parent[find(i)] = find(j);

  const target = corners.map(weld);
  const anchors = new Map<number, number[]>();
  for (let i = 0; i < corners.length; i++) {
    const moved = Math.hypot(
      target[i].x - corners[i].x,
      target[i].y - corners[i].y,
    );
    if (moved < 1e-9) continue; // found nothing to weld to
    const shape = find(i);
    const found = anchors.get(shape);
    if (found) found.push(i);
    else anchors.set(shape, [i]);
  }

  const placed = corners.map((p, i) => {
    const anchor = anchors.get(find(i));
    if (anchor?.length !== 1) return target[i];
    const [only] = anchor;
    return {
      x: p.x + (target[only].x - corners[only].x),
      y: p.y + (target[only].y - corners[only].y),
    };
  });
  return pairs.map(([i, j]) => ({ a: placed[i], b: placed[j] }));
}

/**
 * Free draw: ink in, walls out.
 *
 * One stroke is one gesture — press, drag, release — and the walls appear the
 * moment the finger lifts. Nothing is left in a holding pen: there is no
 * "convert" step to find, and no pile of ink to reason about, so the drawing is
 * always the real thing and undo means what it usually means.
 *
 * The tool stays armed after each stroke, because a plan is not one stroke. It
 * is put down from the same button that armed it.
 *
 * The recognition itself is core's (`recognizeWalls`): simplify, weld corners,
 * straighten near-axis runs. This tool owns only the gesture, the ink while it
 * lasts, the guidance drawn over it, and mapping the segments onto WALL.ADD.
 */
export class SketchTool implements Tool {
  readonly id = 'sketch';
  private ctx: ToolContext | null = null;
  /** the stroke being drawn, in world points; null between strokes */
  private stroke: Point[] | null = null;

  constructor(
    private ui: EditorUi,
    /** extra WALL.ADD params resolved at dispatch time (layer, level, type) */
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.stroke = null;
    this.ui.prompt.set('Free draw — draw a wall, it is built as you lift off');
  }

  deactivate(): void {
    this.ctx = null;
    this.stroke = null;
    this.clearGuidance();
  }

  /**
   * The pen takes EVERY drag, wherever it starts.
   *
   * Touch input asks the tool this before deciding whether a one-finger drag
   * belongs to the tool or pans the canvas, and the drawing tools all say no —
   * they are tap-to-place, so a finger is free to pan. A pen that said no would
   * never receive a stroke at all: on a phone it is the only gesture it has.
   * Two fingers still pinch and pan, which is where navigation goes.
   */
  hitDraggable(): boolean {
    return true;
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.ctx) return;
    this.stroke = [e.point];
    this.ui.setInk([this.stroke]);
  }

  onPointerMove(e: ToolInputEvent): void {
    const stroke = this.stroke;
    if (!stroke) return;
    const last = stroke[stroke.length - 1];
    if (Math.hypot(e.point.x - last.x, e.point.y - last.y) < MIN_SAMPLE) return;
    stroke.push(e.point);
    // a fresh array each time: the overlay is state, and a mutated array in
    // place is a redraw that never happens
    this.ui.setInk([[...stroke]]);
    this.showGuidance(stroke);
  }

  onPointerUp(e: ToolInputEvent): void {
    const ctx = this.ctx;
    const stroke = this.stroke;
    this.stroke = null;
    this.clearGuidance();
    if (!ctx || !stroke) return;
    stroke.push(e.point);

    const segments = recognizeWalls([stroke]);
    // a tap, or a flick too small to mean anything: the ink simply goes
    if (segments.length === 0) return;

    /*
     * Weld the recognized ends onto the plan they were drawn against.
     *
     * The recognizer welds a stroke's own corners, and knows nothing else — it
     * is pure math over one set of strokes. So a second stroke came out a
     * centimetre or two off the first one's corners, and a centimetre is a
     * mile: walls that do not share an endpoint do not join, so their caps do
     * not miter (they overshoot and lie across each other), and the loop does
     * not close, so no room is detected. A room drawn under another one simply
     * did not become a room.
     *
     * A wall placed by tapping never has this problem, because the taps
     * THEMSELVES are snapped to existing geometry before the command sees them.
     * This gives the pen the same thing at the same point in the story: after
     * the shape is decided, before it is committed. Endpoints only — an end
     * landing on a wall's BODY is a tee, and the join and resolve rules
     * already handle that without moving anything.
     *
     * Welding is decided against the document as it stands at lift-off, not
     * one wall at a time, so a stroke cannot chase corners it is creating.
     *
     * How the shape is moved onto its welds is `weldOntoPlan`'s business: a
     * single anchor slides the whole shape rather than pivoting a wall off the
     * axis the recognizer just gave it.
     */
    const welded = weldOntoPlan(
      segments,
      (p) => ctx.snap.snap(p, WELD_TOLERANCE, ['endpoint'])?.point ?? p,
    );

    for (const segment of welded) {
      // a segment whose ends welded to the same corner is not a wall
      if (
        Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y) <
        WELD_TOLERANCE / 2
      ) {
        continue;
      }
      ctx.dispatch<EntityId>('WALL.ADD', {
        a: segment.a,
        b: segment.b,
        ...(this.extraParams?.() ?? {}),
      });
    }
  }

  onKey(key: string): void {
    // the stroke in hand is abandoned; the tool stays armed, because Escape
    // meaning "throw this away" and "put the pen down" at once is a trap
    if (key === 'Escape') {
      this.stroke = null;
      this.clearGuidance();
    }
  }

  /**
   * What the stroke will BECOME, drawn while it is still being drawn.
   *
   * Freehand is the one tool where what you draw is not what you get — the ink
   * bends, the walls come out straight, and a corner you rounded comes out
   * square. Showing only the ink means the result is a surprise on every lift.
   * So the same recognition that runs on release runs live: the walls appear as
   * a dashed ghost, and the segment under the finger carries the length and
   * bearing readout the wall tool uses, so a run can be drawn to a number.
   */
  private showGuidance(stroke: readonly Point[]): void {
    const segments = recognizeWalls([stroke]);
    if (segments.length === 0) {
      this.ui.setGhost(null);
      this.ui.setRubber(null);
      return;
    }
    const ghost: Geometry[] = segments.map((s) => ({
      kind: 'segment',
      a: s.a,
      b: s.b,
    }));
    this.ui.setGhost(ghost);
    // the last recognized segment is the one still under the finger
    const live = segments[segments.length - 1];
    this.ui.setRubber({ a: live.a, b: live.b });
  }

  private clearGuidance(): void {
    this.ui.setInk(null);
    this.ui.setGhost(null);
    this.ui.setRubber(null);
  }
}
