import type {
  EntityId,
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import {
  HostedOpeningEntity,
  WallEntity,
  add,
  bboxExpand,
  bboxFromPoints,
  dot,
  isEntityInteractive,
  scale,
  sub,
} from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

const clamp = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, v));

export interface PlacedSpan {
  /** normalized position of the opening's CENTRE along the wall baseline */
  readonly t: number;
  /** meters, or null for a tap — then the ADD command's own default applies */
  readonly width: number | null;
  /** the span's ends in world space, for the live preview */
  readonly a: Point;
  readonly b: Point;
}

/**
 * Where a press → release along a wall puts an opening: the centre sits
 * between the two points, the width is the distance between them, and both
 * are clamped so the opening stays on the wall.
 *
 * A gesture too short to be a deliberate size is a tap, and reports no width:
 * the caller then leaves it off the command so the default applies — a door
 * and a window do not agree on what that is, and only the command knows.
 */
export function planOpeningSpan(
  baseline: { a: Point; b: Point },
  from: Point,
  to: Point,
): PlacedSpan {
  const ab = sub(baseline.b, baseline.a);
  const len = Math.hypot(ab.x, ab.y);
  if (len === 0) {
    return { t: 0.5, width: null, a: baseline.a, b: baseline.a };
  }
  const u = scale(ab, 1 / len);
  const along = (p: Point): number => clamp(dot(sub(p, baseline.a), u), 0, len);
  const start = along(from);
  const end = along(to);
  if (Math.abs(end - start) < HostedOpeningEntity.MIN_WIDTH) {
    const at = add(baseline.a, scale(u, start));
    return { t: start / len, width: null, a: at, b: at };
  }
  const width = Math.min(Math.abs(end - start), len);
  const half = width / 2;
  const at = clamp((start + end) / 2, half, len - half);
  return {
    t: at / len,
    width,
    a: add(baseline.a, scale(u, at - half)),
    b: add(baseline.a, scale(u, at + half)),
  };
}

/** the wall a press landed on, held for the rest of the gesture */
interface Press {
  readonly wallId: EntityId;
  readonly baseline: { a: Point; b: Point };
  readonly from: Point;
}

/**
 * Place a hosted opening (window, door) by dragging it out along a wall:
 * press on the wall, drag to the far side of the opening, release. The host
 * is decided by the press and held for the whole drag, so a finger that
 * wanders off the wall still sizes the opening it started on.
 *
 * A press that releases without travelling stays a tap and places one at the
 * command's default width.
 */
export class HostedPlaceTool implements Tool {
  private ctx: ToolContext | null = null;
  private press: Press | null = null;

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
    this.arm();
  }

  deactivate(): void {
    this.ctx = null;
    this.press = null;
    this.ui.setPending(null);
  }

  /**
   * Claim a press that lands on a wall, so one finger drags the opening's
   * width out instead of panning. Off the wall there is nothing to place, so
   * the press stays a pan.
   */
  hitDraggable(point: Point, tolerance: number): boolean {
    return this.wallAt(point, tolerance) !== null;
  }

  onPointerDown(e: ToolInputEvent): void {
    if (!this.ctx) return;
    const wall = this.wallAt(e.point, this.getTolerance());
    if (!wall) {
      this.ui.appendLog('No wall under cursor.', 'error');
      return;
    }
    this.press = {
      wallId: wall.id,
      baseline: wall.getBaseline(),
      from: e.point,
    };
    // shows up the instant the finger lands, before any movement
    this.preview(e.point);
    this.ui.prompt.set('Drag along the wall to size it, release to place');
  }

  onPointerMove(e: ToolInputEvent): void {
    this.preview(e.point);
  }

  onPointerUp(e: ToolInputEvent): void {
    const ctx = this.ctx;
    const press = this.press;
    this.press = null;
    this.ui.setPending(null);
    if (!ctx || !press) return;
    const span = planOpeningSpan(press.baseline, press.from, e.point);
    // the active layer decides where new work lands, and an opening is new
    // work like any other — without this one it would be stranded on the
    // default layer while the walls around it went somewhere else
    const layerId = this.ui.activeLayerId.get();
    ctx.dispatch(this.commandName, {
      wallId: press.wallId,
      t: span.t,
      ...(span.width === null ? {} : { width: span.width }),
      ...(layerId ? { layerId } : {}),
    });
    this.arm();
  }

  onKey(key: string): void {
    if (key !== 'Escape') return;
    // a cancelled touch drops the opening being dragged out; Escape with
    // nothing in hand puts the tool away
    if (this.press) {
      this.press = null;
      this.ui.setPending(null);
      this.arm();
      return;
    }
    this.onFinish();
  }

  private arm(): void {
    this.ui.prompt.set(`${this.label} — drag along a wall to place`);
  }

  /**
   * The band under the finger IS the opening being sized, so it carries the
   * width as a number — the drafting question while dragging is "how wide",
   * and the pending band alone cannot answer it.
   */
  private preview(cursor: Point): void {
    const press = this.press;
    if (!press) return;
    const span = planOpeningSpan(press.baseline, press.from, cursor);
    this.ui.setPending({ a: span.a, b: span.b, measured: true });
  }

  private wallAt(point: Point, tolerance: number): WallEntity | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const area = bboxExpand(bboxFromPoints([point]), tolerance);
    const walls = ctx.doc
      .queryBBox(area)
      .filter((ent): ent is WallEntity => ent instanceof WallEntity)
      .filter(
        (wall) =>
          isEntityInteractive(ctx.doc, wall) && wall.hitTest(point, tolerance),
      );
    return walls[walls.length - 1] ?? null;
  }
}
