import type {
  Entity,
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import {
  bboxExpand,
  bboxFromPoints,
  detectSpaces,
  distance,
  hasGrips,
  isEntityInteractive,
  pointInLoop,
  sub,
  transformGeometry,
  translation,
} from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import type { EditorUi } from '../ui-state';

type Mode =
  | { kind: 'idle' }
  | { kind: 'maybe-drag'; start: Point; ids: EntityId[] }
  | { kind: 'drag'; start: Point; ids: EntityId[] }
  | { kind: 'grip'; entityId: EntityId; index: number; start: Point }
  | { kind: 'box'; start: Point; additive: boolean };

/**
 * Default tool: click select (shift toggles), drag selected entities with a
 * ghost preview, drag grips to stretch, drag on empty space for window
 * (left→right, fully inside) or crossing (right→left, touching) selection.
 * Every mutation is one command → one undo step.
 */
export class SelectTool implements Tool {
  readonly id = 'select';
  private ctx: ToolContext | null = null;
  private mode: Mode = { kind: 'idle' };

  constructor(
    private ui: EditorUi,
    private getTolerance: () => number,
  ) {}

  activate(ctx: ToolContext): void {
    this.ctx = ctx;
    this.mode = { kind: 'idle' };
    this.ui.prompt.set(
      'Select (Shift = toggle, drag = move/box, grips = stretch)',
    );
  }

  deactivate(): void {
    this.ctx = null;
    this.mode = { kind: 'idle' };
    this.ui.setGhost(null);
    this.ui.setBox(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tolerance = this.getTolerance();

    // 1) grips of selected entities take priority
    const grip = this.gripAt(e.point, tolerance * 1.5);
    if (grip) {
      this.mode = { kind: 'grip', ...grip, start: e.point };
      this.ui.prompt.set('Specify new grip position');
      return;
    }

    // 2) entity under cursor → select + arm drag
    const hit = this.topHit(e.point, tolerance);
    if (hit) {
      if (e.modifiers.shift) {
        ctx.selection.toggle(hit.id);
      } else if (!ctx.selection.has(hit.id)) {
        ctx.selection.clear();
        ctx.selection.add(hit.id);
      }
      const ids = ctx.selection.list();
      if (ids.length > 0)
        this.mode = { kind: 'maybe-drag', start: e.point, ids: [...ids] };
      return;
    }

    // 3) empty space → box selection
    this.mode = { kind: 'box', start: e.point, additive: e.modifiers.shift };
  }

  onPointerMove(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    switch (this.mode.kind) {
      case 'maybe-drag': {
        if (distance(e.point, this.mode.start) > this.getTolerance()) {
          this.mode = {
            kind: 'drag',
            start: this.mode.start,
            ids: this.mode.ids,
          };
          this.updateGhost(e.point);
        }
        break;
      }
      case 'drag':
        this.updateGhost(e.point);
        break;
      case 'grip':
        this.ui.setRubber({ a: this.mode.start, b: e.point });
        break;
      case 'box':
        this.ui.setBox({
          a: this.mode.start,
          b: e.point,
          crossing: e.point.x < this.mode.start.x,
        });
        break;
      case 'idle':
        break;
    }
  }

  onPointerUp(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const mode = this.mode;
    this.mode = { kind: 'idle' };
    this.ui.setGhost(null);
    this.ui.setBox(null);
    this.ui.setRubber(null);

    switch (mode.kind) {
      case 'drag': {
        const delta = sub(e.point, mode.start);
        if (delta.x !== 0 || delta.y !== 0) {
          ctx.dispatch('ENTITY.MOVE', { ids: mode.ids, delta });
        }
        break;
      }
      case 'grip':
        ctx.dispatch('GRIP.MOVE', {
          id: mode.entityId,
          index: mode.index,
          to: e.point,
        });
        this.ui.prompt.set(
          'Select (Shift = toggle, drag = move/box, grips = stretch)',
        );
        break;
      case 'box':
        this.applyBoxSelection(mode, e.point);
        break;
      default:
        break;
    }
  }

  onKey(key: string): void {
    if (key !== 'Escape') return;
    this.mode = { kind: 'idle' };
    this.ui.setGhost(null);
    this.ui.setBox(null);
    this.ui.setRubber(null);
    this.ctx?.selection.clear();
  }

  private topHit(point: Point, tolerance: number): Entity | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    const area = bboxExpand(bboxFromPoints([point]), tolerance);
    const hits = ctx.doc
      .queryBBox(area)
      .filter(
        (ent) =>
          isEntityInteractive(ctx.doc, ent) && ent.hitTest(point, tolerance),
      );
    return hits[hits.length - 1] ?? null;
  }

  /** boundary walls of the detected room containing the point, or null */
  private roomWallsAt(point: Point): EntityId[] | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    for (const space of detectSpaces(ctx.doc, null)) {
      if (
        space.boundaryWallIds.length > 0 &&
        pointInLoop(point, space.boundary)
      )
        return [...space.boundaryWallIds];
    }
    return null;
  }

  private gripAt(
    point: Point,
    tolerance: number,
  ): { entityId: EntityId; index: number } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    for (const id of ctx.selection.list()) {
      const entity = ctx.doc.get(id);
      if (!entity || !hasGrips(entity)) continue;
      for (const grip of entity.getGrips()) {
        if (distance(grip.point, point) <= tolerance) {
          return { entityId: id, index: grip.index };
        }
      }
    }
    return null;
  }

  private updateGhost(cursor: Point): void {
    const ctx = this.ctx;
    if (!ctx || this.mode.kind !== 'drag') return;
    const m = translation(sub(cursor, this.mode.start));
    const ghost = this.mode.ids
      .map((id) => ctx.doc.get(id))
      .filter((ent): ent is Entity => ent !== null)
      .map((ent) => transformGeometry(ent.getEffectiveGeometry(), m));
    this.ui.setGhost(ghost);
  }

  private applyBoxSelection(
    mode: Extract<Mode, { kind: 'box' }>,
    end: Point,
  ): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tiny = distance(end, mode.start) <= this.getTolerance();
    if (tiny) {
      // click on empty space — inside a room? select that room's walls, so a
      // single tap gives the numeric room editor something to edit
      const roomWalls = this.roomWallsAt(mode.start);
      if (!mode.additive) ctx.selection.clear();
      if (roomWalls) for (const id of roomWalls) ctx.selection.add(id);
      return;
    }
    const box = bboxFromPoints([mode.start, end]);
    const crossing = end.x < mode.start.x;
    const candidates = ctx.doc.queryBBox(box).filter((ent) => {
      if (!isEntityInteractive(ctx.doc, ent)) return false;
      if (crossing) return true; // bbox intersection is enough for crossing
      const b = ent.getBounds();
      return (
        b.minX >= box.minX &&
        b.maxX <= box.maxX &&
        b.minY >= box.minY &&
        b.maxY <= box.maxY
      );
    });
    if (!mode.additive) ctx.selection.clear();
    for (const ent of candidates) ctx.selection.add(ent.id);
  }
}
