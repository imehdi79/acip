import type {
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import { distance, normalize, sub } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';
import { lengthUnit, parseLength } from '../units';
import { alignGuides, constrainAngle } from './drafting';
import type { AlignGuide } from './drafting';

/**
 * Shared state machine for two-point chained drawing (LINE, WALL): gathers
 * points interactively, then dispatches the same command an agent would call
 * with params upfront.
 *
 * Two ways to place a segment, because a phone and a mouse want different
 * things:
 *
 * - **drag** (the touch flow): press, a provisional wall appears and blinks,
 *   drag to aim it, release to commit. One segment per gesture.
 * - **tap-tap** (the chained flow): a press that releases without moving
 *   plants the first point and waits; the next press places the segment and
 *   continues the chain from it, until Escape.
 *
 * Drafting aids apply to both: the cursor angle-snaps (Shift = ortho) and
 * tracks the X/Y of existing corners with dashed guides; typing a number sets
 * the exact length along the current direction (Enter places it).
 */
export class ChainedDrawTool implements Tool {
  private ctx: ToolContext | null = null;
  private last: Point | null = null;
  /** the most recent pointer position, so typing can re-aim off it */
  private cursor: ToolInputEvent | null = null;
  /** dynamic input: digits typed since the last point (empty = none) */
  private typed = '';
  /** the point the next click / Enter will place */
  private target: Point | null = null;
  /** where the current press went down — a release far from it is a drag */
  private pressedAt: Point | null = null;

  constructor(
    readonly id: string,
    private label: string,
    private commandName: string,
    private ui: EditorUi,
    private onFinish: () => void,
    private getTolerance: () => number,
    /** extra command params resolved at dispatch time (e.g. active level) */
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.reset();
    this.ui.prompt.set(`${this.label} — specify first point`);
  }

  deactivate(): void {
    this.ctx = null;
    this.reset();
  }

  private reset(): void {
    this.last = null;
    this.cursor = null;
    this.target = null;
    this.typed = '';
    this.pressedAt = null;
    this.ui.setRubber(null);
    this.ui.setGuides(null);
    this.ui.setPending(null);
    this.ui.draftLength.set(null);
  }

  /**
   * Claim every press while this tool is armed, so a one-finger drag draws
   * instead of panning the viewport. Two fingers still pinch and pan.
   */
  hitDraggable(): boolean {
    return this.ctx !== null;
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    this.pressedAt = e.point;
    if (!this.last) {
      this.last = e.point;
      this.cursor = e;
      // shows up the instant the finger lands, before any movement
      this.ui.setPending({ a: e.point, b: e.point });
      this.ui.prompt.set('Drag to aim, release to place (Shift = 90°)');
      return;
    }
    // a click always uses the cursor position (angle/align-snapped), and drops
    // any half-typed length — the pointer wins over the keyboard buffer
    this.typed = '';
    this.cursor = e;
    const { point } = this.resolve(e);
    this.place(point);
  }

  onPointerMove(e: ToolInputEvent): void {
    if (!this.last) return;
    this.cursor = e;
    this.recompute();
  }

  onPointerUp(e: ToolInputEvent): void {
    const pressedAt = this.pressedAt;
    this.pressedAt = null;
    if (!this.ctx || !this.last || !pressedAt) return;
    // a release that never travelled is a tap: leave the first point planted
    // so the next tap completes the segment
    if (distance(e.point, pressedAt) < this.getTolerance()) return;
    this.typed = '';
    this.cursor = e;
    this.place(this.resolve(e).point);
    // one segment per gesture — the next press starts a fresh wall
    this.last = null;
    this.cursor = null;
    this.ui.setPending(null);
    this.ui.prompt.set(`${this.label} — specify first point`);
  }

  onKey(key: string): void {
    if (key === 'Enter') {
      if (this.typed && this.target && this.last) this.place(this.target);
      else this.finishOrClear();
      return;
    }
    if (key === 'Escape') {
      if (this.typed) {
        this.typed = '';
        this.ui.draftLength.set(null);
        this.recompute();
      } else {
        this.finishOrClear();
      }
      return;
    }
    if (!this.last) return;
    // dynamic length input: digits, one decimal point, backspace
    if (/^[0-9]$/.test(key) || (key === '.' && !this.typed.includes('.'))) {
      this.typed += key;
    } else if (key === 'Backspace') {
      this.typed = this.typed.slice(0, -1);
    } else {
      return;
    }
    this.ui.draftLength.set(this.typed || null);
    this.recompute();
  }

  private finishOrClear(): void {
    if (this.last) {
      this.reset();
      this.ui.prompt.set(`${this.label} — specify first point`);
    } else {
      this.onFinish();
    }
  }

  /** dispatch a segment last → point, then continue the chain from point */
  private place(point: Point): void {
    const ctx = this.ctx;
    if (!ctx || !this.last) return;
    ctx.dispatch(this.commandName, {
      a: this.last,
      b: point,
      ...this.extraParams?.(),
    });
    this.last = point;
    this.typed = '';
    this.target = null;
    this.ui.setRubber(null);
    this.ui.setGuides(null);
    // the real wall exists now; the provisional one re-anchors to the new
    // chain start (tap-tap) or is cleared by the caller (drag)
    this.ui.setPending({ a: point, b: point });
    this.ui.draftLength.set(null);
  }

  /** rebuild the rubber preview + target from the live cursor and typed length */
  private recompute(): void {
    if (!this.last || !this.cursor) return;
    const res = this.resolve(this.cursor);
    let target = res.point;
    const meters = this.typed
      ? parseLength(this.typed, lengthUnit.get())
      : null;
    if (meters !== null && meters > 0) {
      // keep the aimed direction, override the distance with the typed value
      const dir = normalize(sub(res.point, this.last));
      if (dir.x !== 0 || dir.y !== 0) {
        target = {
          x: this.last.x + dir.x * meters,
          y: this.last.y + dir.y * meters,
        };
      }
    }
    this.target = target;
    this.ui.setRubber({
      a: this.last,
      b: target,
      angleLocked: res.locked && !this.typed,
    });
    // the provisional wall tracks the aim, so the finger drags a wall rather
    // than a hairline
    this.ui.setPending({ a: this.last, b: target });
    this.ui.setGuides(res.guides.length > 0 ? res.guides : null);
  }

  /**
   * Angle-snap the cursor relative to the last point, then object-snap track to
   * existing corners. A real object snap (endpoint/midpoint) or Shift-ortho
   * wins outright; otherwise alignment beats the soft polar angle snap.
   */
  private resolve(e: ToolInputEvent): {
    point: Point;
    locked: boolean;
    guides: AlignGuide[];
  } {
    if (!this.last || e.snapped) {
      return { point: e.point, locked: false, guides: [] };
    }
    if (e.modifiers.shift) {
      const r = constrainAngle(this.last, e.point, true);
      return { point: r.point, locked: r.locked, guides: [] };
    }
    if (this.ctx) {
      const align = alignGuides(this.ctx.doc, e.point, this.getTolerance());
      if (align.guides.length > 0) {
        return { point: align.point, locked: false, guides: align.guides };
      }
    }
    const r = constrainAngle(this.last, e.point, false);
    return { point: r.point, locked: r.locked, guides: [] };
  }
}
