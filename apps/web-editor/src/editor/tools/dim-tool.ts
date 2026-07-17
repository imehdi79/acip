import type { Point, Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import { DimensionEntity, cross, distance, normalize, sub } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/**
 * Three-click linear dimension (the DIMLINEAR flow): first extension point,
 * second extension point, then a click that places the dimension line — its
 * signed perpendicular distance from a→b becomes the offset. Dispatches
 * DIM.ADD, the same command the agent calls; the ghost previews the real
 * entity geometry while the offset follows the cursor.
 */
export class DimensionTool implements Tool {
  readonly id = 'dimension';
  private ctx: ToolContext | null = null;
  private a: Point | null = null;
  private b: Point | null = null;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
    /** extra command params resolved at dispatch time (active level/layer) */
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.reset();
  }

  deactivate(): void {
    this.ctx = null;
    this.a = null;
    this.b = null;
    this.ui.setRubber(null);
    this.ui.setGhost(null);
  }

  private reset(): void {
    this.a = null;
    this.b = null;
    this.ui.setRubber(null);
    this.ui.setGhost(null);
    this.ui.prompt.set('DIM — specify first extension point');
  }

  private offsetFor(p: Point): number {
    const d = normalize(sub(this.b!, this.a!));
    return cross(d, sub(p, this.a!));
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.a) {
      this.a = e.point;
      this.ui.prompt.set('Specify second extension point');
      return;
    }
    if (!this.b) {
      if (distance(e.point, this.a) < 1e-6) return;
      this.b = e.point;
      this.ui.setRubber(null);
      this.ui.prompt.set('Place the dimension line');
      return;
    }
    ctx.dispatch('DIM.ADD', {
      a: this.a,
      b: this.b,
      offset: this.offsetFor(e.point),
      ...this.extraParams?.(),
    });
    this.reset();
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.a && !this.b) {
      this.ui.setRubber({ a: this.a, b: e.point });
    } else if (this.a && this.b) {
      const preview = new DimensionEntity();
      preview.def = { kind: 'points', a: this.a, b: this.b };
      preview.offset = this.offsetFor(e.point);
      this.ui.setGhost([preview.getBaseGeometry()]);
    }
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key !== 'Escape') return;
    if (this.a) this.reset();
    else this.onFinish();
  }
}
