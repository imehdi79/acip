import type { Point, Tool, ToolContext, ToolInputEvent } from '@acip/editor-core';
import { angleOf, distance, sub } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

/** center → radius point, with live circle ghost */
export class CircleTool implements Tool {
  readonly id = 'circle';
  private ctx: ToolContext | null = null;
  private center: Point | null = null;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
    private extraParams?: () => Record<string, unknown>,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.center = null;
    this.ui.prompt.set('CIRCLE — specify center');
  }

  deactivate(): void {
    this.ctx = null;
    this.center = null;
    this.ui.setGhost(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.center) {
      this.center = e.point;
      this.ui.prompt.set('Specify radius point');
      return;
    }
    const radius = distance(this.center, e.point);
    if (radius > 1e-9) {
      ctx.dispatch('CIRCLE.ADD', { center: this.center, radius, ...this.extraParams?.() });
    }
    this.center = null;
    this.ui.setGhost(null);
    this.ui.prompt.set('CIRCLE — specify center');
  }

  onPointerMove(e: ToolInputEvent): void {
    if (!this.center) return;
    const radius = distance(this.center, e.point);
    this.ui.setGhost(radius > 1e-9 ? [{ kind: 'circle', center: this.center, radius }] : null);
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key !== 'Escape') return;
    if (this.center) {
      this.center = null;
      this.ui.setGhost(null);
      this.ui.prompt.set('CIRCLE — specify center');
    } else {
      this.onFinish();
    }
  }
}

/** center → start point (radius + start angle) → end point (end angle) */
export class ArcTool implements Tool {
  readonly id = 'arc';
  private ctx: ToolContext | null = null;
  private center: Point | null = null;
  private start: Point | null = null;

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
    this.center = null;
    this.start = null;
    this.ui.setGhost(null);
  }

  private reset(): void {
    this.center = null;
    this.start = null;
    this.ui.setGhost(null);
    this.ui.prompt.set('ARC — specify center');
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (!this.center) {
      this.center = e.point;
      this.ui.prompt.set('Specify start point (radius + start angle)');
      return;
    }
    if (!this.start) {
      if (distance(this.center, e.point) < 1e-9) return;
      this.start = e.point;
      this.ui.prompt.set('Specify end point (sweep is counter-clockwise)');
      return;
    }
    const radius = distance(this.center, this.start);
    ctx.dispatch('ARC.ADD', {
      center: this.center,
      radius,
      startAngle: angleOf(sub(this.start, this.center)),
      endAngle: angleOf(sub(e.point, this.center)),
      ...this.extraParams?.(),
    });
    this.reset();
  }

  onPointerMove(e: ToolInputEvent): void {
    if (!this.center) return;
    if (!this.start) {
      const radius = distance(this.center, e.point);
      this.ui.setGhost(radius > 1e-9 ? [{ kind: 'circle', center: this.center, radius }] : null);
      return;
    }
    this.ui.setGhost([
      {
        kind: 'arc',
        center: this.center,
        radius: distance(this.center, this.start),
        startAngle: angleOf(sub(this.start, this.center)),
        endAngle: angleOf(sub(e.point, this.center)),
      },
    ]);
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key !== 'Escape') return;
    if (this.center || this.start) this.reset();
    else this.onFinish();
  }
}

/**
 * Click vertices; Enter finishes open, clicking near the first vertex closes,
 * Escape cancels. One POLYLINE.ADD dispatch = one undo step.
 */
export class PolylineTool implements Tool {
  readonly id = 'polyline';
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
    this.ui.prompt.set('POLYLINE — specify first vertex');
  }

  deactivate(): void {
    this.ctx = null;
    this.points = [];
    this.ui.setGhost(null);
    this.ui.setRubber(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.ctx) return;
    // clicking the first vertex again closes the polyline
    if (this.points.length >= 3 && distance(e.point, this.points[0]) <= this.getTolerance()) {
      this.commit(true);
      return;
    }
    this.points.push(e.point);
    this.ui.prompt.set(
      this.points.length < 2
        ? 'Specify next vertex'
        : 'Next vertex · Enter = finish · click first vertex = close',
    );
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.points.length === 0) return;
    this.ui.setRubber({ a: this.points[this.points.length - 1], b: e.point });
    if (this.points.length >= 2) {
      this.ui.setGhost([{ kind: 'polyline', points: this.points, closed: false }]);
    }
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key === 'Enter') {
      this.commit(false);
      return;
    }
    if (key !== 'Escape') return;
    if (this.points.length > 0) {
      this.points = [];
      this.ui.setGhost(null);
      this.ui.setRubber(null);
      this.ui.prompt.set('POLYLINE — specify first vertex');
    } else {
      this.onFinish();
    }
  }

  private commit(closed: boolean): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (this.points.length >= 2) {
      ctx.dispatch('POLYLINE.ADD', { points: this.points, closed, ...this.extraParams?.() });
    }
    this.points = [];
    this.ui.setGhost(null);
    this.ui.setRubber(null);
    this.ui.prompt.set('POLYLINE — specify first vertex');
  }
}
