import type {
  EntityId,
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import { recognizeWalls } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

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
 * lasts, and mapping the segments onto WALL.ADD.
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
    this.ui.setInk(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.ctx) return;
    this.stroke = [e.point];
    this.ui.setInk([this.stroke]);
  }

  onPointerMove(e: ToolInputEvent): void {
    if (!this.stroke) return;
    this.stroke.push(e.point);
    // a fresh array each time: the overlay is state, and a mutated array in
    // place is a redraw that never happens
    this.ui.setInk([[...this.stroke]]);
  }

  onPointerUp(e: ToolInputEvent): void {
    const ctx = this.ctx;
    const stroke = this.stroke;
    this.stroke = null;
    this.ui.setInk(null);
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
      this.ui.setInk(null);
    }
  }
}
