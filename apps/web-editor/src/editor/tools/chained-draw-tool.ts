import type { Point, Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/**
 * Shared state machine for two-point chained drawing (LINE, WALL): gathers
 * points interactively, then dispatches the same command an agent would call
 * with params upfront. Each click continues from the last point until Escape.
 */
export class ChainedDrawTool implements Tool {
  private ctx: ToolContext | null = null;
  private last: Point | null = null;

  constructor(
    readonly id: string,
    private label: string,
    private commandName: string,
    private ui: EditorUi,
    private onFinish: () => void,
    /** extra command params resolved at dispatch time (e.g. active level) */
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.last = null;
    this.ui.prompt.set(`${this.label} — specify first point`);
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
    ctx.dispatch(this.commandName, { a: this.last, b: e.point, ...this.extraParams?.() });
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
      this.ui.prompt.set(`${this.label} — specify first point`);
    } else {
      this.onFinish();
    }
  }
}
