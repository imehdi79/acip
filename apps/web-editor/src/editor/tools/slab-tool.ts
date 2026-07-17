import type { Point, Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import { distance } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/**
 * Click footprint vertices; clicking the first vertex or pressing Enter
 * closes and commits (slabs are always closed). One SLAB.ADD dispatch =
 * one undo step — the same command SLAB.AUTO and agents call.
 */
export class SlabTool implements Tool {
  readonly id = 'slab';
  private ctx: ToolContext | null = null;
  private points: Point[] = [];

  constructor(
    private ui: EditorUi,
    private getTolerance: () => number,
    private onFinish: () => void,
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.points = [];
    this.ui.prompt.set('SLAB — specify first footprint vertex');
  }

  deactivate(): void {
    this.ctx = null;
    this.points = [];
    this.ui.setGhost(null);
    this.ui.setRubber(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.ctx) return;
    if (this.points.length >= 3 && distance(e.point, this.points[0]) <= this.getTolerance()) {
      this.commit();
      return;
    }
    this.points.push(e.point);
    this.ui.prompt.set(
      this.points.length < 3
        ? 'Specify next vertex'
        : 'Next vertex · Enter or click first vertex = close slab',
    );
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.points.length === 0) return;
    this.ui.setRubber({ a: this.points[this.points.length - 1], b: e.point });
    if (this.points.length >= 2) {
      this.ui.setGhost([{ kind: 'polyline', points: [...this.points, e.point], closed: true }]);
    }
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key === 'Enter') {
      this.commit();
      return;
    }
    if (key !== 'Escape') return;
    if (this.points.length > 0) {
      this.points = [];
      this.ui.setGhost(null);
      this.ui.setRubber(null);
      this.ui.prompt.set('SLAB — specify first footprint vertex');
    } else {
      this.onFinish();
    }
  }

  private commit(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.points.length >= 3) {
      ctx.dispatch('SLAB.ADD', { points: this.points, ...this.extraParams?.() });
    }
    this.points = [];
    this.ui.setGhost(null);
    this.ui.setRubber(null);
    this.ui.prompt.set('SLAB — specify first footprint vertex');
  }
}
