import type { Point, Tool, ToolInputEvent } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';
import { calibrateUnderlay } from '../underlay';

/**
 * Two-point underlay scale calibration: click both ends of a distance you
 * know (a dimension line, a door opening), type the real meters, and the
 * image stretches to true size around the first point.
 */
export class CalibrateTool implements Tool {
  readonly id = 'calibrate';
  private a: Point | null = null;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
  ) {}

  activate(): void {
    this.a = null;
    this.ui.prompt.set('CALIBRATE — click the first point of a known distance');
  }

  deactivate(): void {
    this.a = null;
    this.ui.setRubber(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.a) {
      this.a = e.point;
      this.ui.prompt.set('Click the second point');
      return;
    }
    const underlay = this.ui.underlay.get();
    const measured = Math.hypot(e.point.x - this.a.x, e.point.y - this.a.y);
    if (underlay && measured > 1e-9) {
      const answer = window.prompt(
        'Real distance between the two points, in meters:',
      );
      const real = Number(answer);
      if (Number.isFinite(real) && real > 0) {
        this.ui.underlay.set(
          calibrateUnderlay(underlay, this.a, e.point, real),
        );
        this.ui.appendLog(
          `Underlay calibrated: ${measured.toFixed(2)} m on screen = ${real} m real.`,
        );
      }
    }
    this.ui.setRubber(null);
    this.onFinish();
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.a) this.ui.setRubber({ a: this.a, b: e.point });
  }

  onPointerUp(): void {}

  onKey(key: string): void {
    if (key === 'Escape') this.onFinish();
  }
}

/**
 * Drag a rectangle over the underlay; the region is cropped and handed to
 * the drafter to trace into real walls. Selection only — the crop/agent
 * hand-off lives in underlay.ts so this stays a pure input state machine.
 */
export class TraceTool implements Tool {
  readonly id = 'trace';
  private start: Point | null = null;

  constructor(
    private ui: EditorUi,
    private onFinish: () => void,
    private onRegion: (a: Point, b: Point) => void,
  ) {}

  activate(): void {
    this.start = null;
    this.ui.prompt.set('TRACE — drag a rectangle over the plan region');
  }

  deactivate(): void {
    this.start = null;
    this.ui.setBox(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    this.start = e.point;
  }

  onPointerMove(e: ToolInputEvent): void {
    if (this.start)
      this.ui.setBox({ a: this.start, b: e.point, crossing: false });
  }

  onPointerUp(e: ToolInputEvent): void {
    const start = this.start;
    this.start = null;
    this.ui.setBox(null);
    if (!start) return;
    const w = Math.abs(e.point.x - start.x);
    const h = Math.abs(e.point.y - start.y);
    if (w < 0.2 || h < 0.2) {
      this.ui.prompt.set('TRACE — drag a rectangle over the plan region');
      return;
    }
    this.onFinish();
    this.onRegion(start, e.point);
  }

  onKey(key: string): void {
    if (key === 'Escape') this.onFinish();
  }
}
