import type {
  EntityId,
  Geometry,
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
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

    for (const segment of segments) {
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
