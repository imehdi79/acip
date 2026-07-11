import type { Point, Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/**
 * Reference draw tool. Gathers points interactively, then dispatches the same
 * LINE.ADD an agent would call with params upfront. Chained placement
 * (AutoCAD-style): each click continues from the last point until Escape.
 */
export class LineTool implements Tool {
  readonly id = 'line';
  private ctx: ToolContext | null = null;
  private last: Point | null = null;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.last = null;
    this.ui.prompt.set('LINE — specify first point');
  }

  deactivate(): void {
    this.ctx = null;
    this.last = null;
    this.ui.setRubber(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.last) {
      this.last = e.point;
      this.ui.prompt.set('Specify next point (Esc to finish)');
      return;
    }
    ctx.dispatch('LINE.ADD', { a: this.last, b: e.point });
    this.last = e.point;
    this.ui.setRubber(null);
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.last) this.ui.setRubber({ a: this.last, b: e.point });
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key !== 'Escape') return;
    if (this.last) {
      this.last = null;
      this.ui.setRubber(null);
      this.ui.prompt.set('LINE — specify first point');
    } else {
      this.onFinish();
    }
  }
}
