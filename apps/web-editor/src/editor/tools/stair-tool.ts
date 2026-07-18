import type {
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import { distance } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/**
 * Two-click straight stair: click the origin (bottom of the flight), then a
 * point that sets the run direction. Dispatches STAIR.ADD — the base is the
 * active level and the top is resolved to the next level up (or a 3 m flight)
 * by the extraParams callback.
 */
export class StairTool implements Tool {
  readonly id = 'stair';
  private ctx: ToolContext | null = null;
  private origin: Point | null = null;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.reset();
  }

  deactivate(): void {
    this.ctx = null;
    this.origin = null;
    this.ui.setRubber(null);
  }

  private reset(): void {
    this.origin = null;
    this.ui.setRubber(null);
    this.ui.prompt.set('STAIR — specify origin (bottom of the flight)');
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.origin) {
      this.origin = e.point;
      this.ui.prompt.set('Specify run direction');
      return;
    }
    if (distance(e.point, this.origin) < 1e-6) return;
    ctx.dispatch('STAIR.ADD', {
      origin: this.origin,
      direction: { x: e.point.x - this.origin.x, y: e.point.y - this.origin.y },
      ...this.extraParams?.(),
    });
    this.reset();
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.origin) this.ui.setRubber({ a: this.origin, b: e.point });
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key !== 'Escape') return;
    if (this.origin) this.reset();
    else this.onFinish();
  }
}
