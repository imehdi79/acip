import type { Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import { bboxExpand, bboxFromPoints } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/** Default tool: pick via core hit-testing (world tolerance), shift toggles. */
export class SelectTool implements Tool {
  readonly id = 'select';
  private ctx: ToolContext | null = null;

  constructor(
    private ui: EditorUi,
    private getTolerance: () => number,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.ui.prompt.set('Select entities (Shift = toggle, Del = erase, Esc = clear)');
  }

  deactivate(): void {
    this.ctx = null;
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tolerance = this.getTolerance();
    const area = bboxExpand(bboxFromPoints([e.point]), tolerance);
    const hits = ctx.doc.queryBBox(area).filter((ent) => ent.hitTest(e.point, tolerance));
    const top = hits[hits.length - 1] ?? null;
    if (!top) {
      if (!e.modifiers.shift) ctx.selection.clear();
      return;
    }
    if (e.modifiers.shift) {
      ctx.selection.toggle(top.id);
    } else {
      ctx.selection.clear();
      ctx.selection.add(top.id);
    }
  }

  onPointerMove(): void {
    // window/crossing selection lands here later
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key === 'Escape') this.ctx?.selection.clear();
  }
}
