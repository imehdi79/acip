import type { Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import { WallEntity, bboxExpand, bboxFromPoints, dot, sub } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

/** Click a wall to place a hosted opening (window, door) at that axis position. */
export class HostedPlaceTool implements Tool {
  private ctx: ToolContext | null = null;

  constructor(
    readonly id: string,
    private label: string,
    private commandName: string,
    private ui: EditorUi,
    private getTolerance: () => number,
    private onFinish: () => void,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.ui.prompt.set(`${this.label} — click a wall to place`);
  }

  deactivate(): void {
    this.ctx = null;
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tolerance = this.getTolerance();
    const area = bboxExpand(bboxFromPoints([e.point]), tolerance);
    const walls = ctx.doc
      .queryBBox(area)
      .filter((ent): ent is WallEntity => ent instanceof WallEntity)
      .filter((wall) => wall.hitTest(e.point, tolerance));
    const wall = walls[walls.length - 1];
    if (!wall) {
      this.ui.appendLog('No wall under cursor.', 'error');
      return;
    }
    const { a, b } = wall.getBaseline();
    const ab = sub(b, a);
    const lenSq = dot(ab, ab);
    const t = lenSq === 0 ? 0.5 : clamp01(dot(sub(e.point, a), ab) / lenSq);
    ctx.dispatch(this.commandName, { wallId: wall.id, t });
  }

  onPointerMove(): void {}

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key === 'Escape') this.onFinish();
  }
}
