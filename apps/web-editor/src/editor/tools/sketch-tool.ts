import type {
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
  WallSegment,
} from '@acip/editor-core';
import { recognizeWalls } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/** min world gap between captured ink samples — thins the pen stream a little */
const MIN_SAMPLE = 0.01;

/**
 * Free-draw: capture freehand pen strokes, then on "Done" recognize them into
 * clean wall segments (simplify + snap + weld, in core) and hand them to
 * `place` for a single grouped WALL.ADD. One finger draws on touch (see
 * hitDraggable); two fingers still pan/zoom. Escape clears, Enter/Done commits.
 */
export class SketchTool implements Tool {
  readonly id = 'sketch';
  private ctx: ToolContext | null = null;
  private strokes: Point[][] = [];
  private current: Point[] | null = null;
  private drawing = false;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
    /** turn recognized segments into walls; returns after selecting + fitting */
    private place: (segments: WallSegment[]) => void,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.reset();
    // clear chips from a previous free-draw run before starting a fresh one
    this.ui.sketchWalls.set([]);
    this.ui.prompt.set('FREE DRAW — sketch your walls, then press Done');
  }

  deactivate(): void {
    this.ctx = null;
    this.reset();
  }

  private reset(): void {
    this.strokes = [];
    this.current = null;
    this.drawing = false;
    this.ui.setInk(null);
    this.ui.sketchStrokes.set(0);
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.ctx) return;
    this.drawing = true;
    this.current = [e.point];
    this.pushInk();
  }

  onPointerMove(e: ToolInputEvent): void {
    if (!this.drawing || !this.current) return;
    const last = this.current[this.current.length - 1];
    if (!last || Math.hypot(e.point.x - last.x, e.point.y - last.y) >= MIN_SAMPLE) {
      this.current.push(e.point);
      this.pushInk();
    }
  }

  onPointerUp(): void {
    if (!this.drawing) return;
    this.drawing = false;
    if (this.current && this.current.length >= 2) {
      this.strokes.push(this.current);
      this.ui.sketchStrokes.set(this.strokes.length);
    }
    this.current = null;
    this.pushInk();
  }

  onKey(key: string): void {
    if (key === 'Enter') {
      this.commit();
      return;
    }
    if (key !== 'Escape') return;
    if (this.strokes.length > 0 || this.current) this.reset();
    else this.onFinish();
  }

  /** touch: one finger always draws with this tool (never pans) */
  hitDraggable(): boolean {
    return true;
  }

  hasStrokes(): boolean {
    return this.strokes.length > 0 || (this.current?.length ?? 0) >= 2;
  }

  /** drop the most recent stroke (or the in-progress one) */
  undoStroke(): void {
    if (this.current) {
      this.current = null;
      this.drawing = false;
    } else {
      this.strokes.pop();
    }
    this.ui.sketchStrokes.set(this.strokes.length);
    this.pushInk();
  }

  /** leave free-draw without recognizing anything */
  cancel(): void {
    this.reset();
    this.onFinish();
  }

  /** recognize the accumulated strokes into walls, then exit to select */
  commit(): void {
    const pending = [...this.strokes];
    if (this.current && this.current.length >= 2) pending.push(this.current);
    const segments = recognizeWalls(pending);
    if (segments.length > 0) this.place(segments);
    this.reset();
    this.onFinish();
  }

  private pushInk(): void {
    const strokes = this.current ? [...this.strokes, this.current] : this.strokes;
    this.ui.setInk(strokes.length > 0 ? strokes.map((s) => [...s]) : null);
  }
}
