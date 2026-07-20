import type {
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/** a tool that can be dragged at a point (grips, room handles, moving) */
interface Draggable {
  hitDraggable(point: Point, tolerance: number): boolean;
}

/**
 * Owns the active tool and forwards abstract input to it. Tools receive
 * core's ToolContext — no DOM beyond this point.
 */
export class ToolManager {
  private tools = new Map<string, Tool>();
  private active: Tool | null = null;

  /** world-space pick tolerance, kept in sync with the camera by the viewport */
  worldTolerance = 0.1;

  constructor(
    private ctx: ToolContext,
    private ui: EditorUi,
  ) {}

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  useById(id: string): void {
    const tool = this.tools.get(id);
    if (!tool || tool === this.active) return;
    this.active?.deactivate();
    this.ui.clearOverlay();
    this.active = tool;
    this.ui.activeToolId.set(tool.id);
    tool.activate(this.ctx);
  }

  pointerDown(e: ToolInputEvent): void {
    this.active?.onPointerDown(e);
  }

  pointerMove(e: ToolInputEvent): void {
    this.active?.onPointerMove(e);
  }

  pointerUp(e: ToolInputEvent): void {
    this.active?.onPointerUp(e);
  }

  key(key: string): void {
    this.active?.onKey(key);
  }

  /**
   * Would the active tool grab a drag at this point? Used by touch input to
   * choose between dragging (move/resize) and panning the canvas — only the
   * select tool opts in; drawing tools stay tap-to-place so one finger pans.
   */
  hitDraggable(point: Point, tolerance: number): boolean {
    const tool = this.active as (Tool & Partial<Draggable>) | null;
    return tool?.hitDraggable?.(point, tolerance) ?? false;
  }
}
