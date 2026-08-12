import type {
  Entity,
  Geometry,
  Point,
  Tool,
  ToolContext,
  ToolInputEvent,
} from '@acip/editor-core';
import {
  detectRectRoom,
  planStickyWallMove,
  rectRoomCorners,
  resizeRectRoomTo,
} from '../rooms';
import type { RectRoom } from '../rooms';
import {
  alignGuides,
  constrainAngle,
  cornerAngles,
  planDragSnap,
} from './drafting';
import type { AlignGuide } from './drafting';
import {
  HostedOpeningEntity,
  JOIN_TOLERANCE,
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
  | {
      kind: 'grip';
      entityId: EntityId;
      index: number;
      start: Point;
      /** the corner's real world position (grip point, not the click) */
      anchor: Point;
      /** the dragged wall/line's OTHER endpoint — angle-snap reference (else null) */
      fixed: Point | null;
      /** move every endpoint stuck to this corner together, not just this one */
      stick: boolean;
    }
  | {
      kind: 'opening-resize';
      entityId: EntityId;
      /** which end is under the finger: 1 = start of the span, 2 = end */
      index: number;
    }
  | { kind: 'room-resize'; room: RectRoom; fixed: Point }
  | { kind: 'box'; start: Point; additive: boolean };

/** smallest room a drag can shrink to (meters) */
const MIN_ROOM = 0.5;

/** axis-aligned rect from a fixed corner and the dragged corner, min-clamped */
function rectFrom(fixed: Point, cursor: Point) {
  let nx = cursor.x;
  let ny = cursor.y;
  if (Math.abs(nx - fixed.x) < MIN_ROOM)
    nx = fixed.x + (nx >= fixed.x ? MIN_ROOM : -MIN_ROOM);
  if (Math.abs(ny - fixed.y) < MIN_ROOM)
    ny = fixed.y + (ny >= fixed.y ? MIN_ROOM : -MIN_ROOM);
  return {
    minX: Math.min(fixed.x, nx),
    minY: Math.min(fixed.y, ny),
    maxX: Math.max(fixed.x, nx),
    maxY: Math.max(fixed.y, ny),
  };
}

/**
 * Default tool: click select (shift, or the multi-select mode, toggles), drag
 * selected entities with a ghost preview, drag grips to stretch, drag on empty
 * space for window (left→right, fully inside) or crossing (right→left,
 * touching) selection. Every mutation is one command → one undo step.
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
    this.ui.prompt.set(this.restingPrompt());
  }

  /**
   * What the tool says for itself when it is not in the middle of anything.
   * Multi-select changes what a tap does, so it changes the sentence too.
   */
  private restingPrompt(): string {
    return this.ui.multiSelect.get()
      ? 'Multi-select: tap to add, tap again to remove'
      : 'Select (Shift = toggle, drag = move/box, grips = stretch)';
  }

  /**
   * Does this tap ADD to the selection rather than replace it? Shift is the
   * desktop answer and the multi-select footer toggle is the touch one — a
   * phone has no modifier to hold — and they mean exactly the same thing, so
   * they resolve to the same additive path rather than to two of them.
   */
  private additive(e: ToolInputEvent): boolean {
    return e.modifiers.shift || this.ui.multiSelect.get();
  }

  deactivate(): void {
    this.ctx = null;
    this.mode = { kind: 'idle' };
    this.ui.setGhost(null);
    this.ui.setBox(null);
    this.ui.setAngles(null);
    this.ui.setGuides(null);
    this.ui.setPending(null);
  }

  onPointerDown(e: ToolInputEvent): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const tolerance = this.getTolerance();
    /*
     * While gathering, a tap picks — it never reshapes. Everything already
     * gathered is showing its grips, and on a plan those grips sit exactly on
     * the corners where the next wall to gather meets the last one. With a
     * fingertip-sized pick radius the grip would win nearly every time, so
     * reaching for one more wall would stretch the one you already had.
     */
    const gathering = this.ui.multiSelect.get();

    // 0) a selected rectangular room: dragging a corner resizes the whole
    // room (takes priority over the coincident individual wall grips)
    const room = gathering
      ? null
      : detectRectRoom(ctx.doc, ctx.selection.list());
    if (room) {
      const cs = rectRoomCorners(room);
      for (let i = 0; i < cs.length; i++) {
        if (distance(cs[i], e.point) <= tolerance * 1.5) {
          this.mode = { kind: 'room-resize', room, fixed: cs[(i + 2) % 4] };
          this.ui.prompt.set('Drag to resize the room');
          return;
        }
      }
    }

    // 1) grips of selected entities take priority
    const grip = gathering ? null : this.gripAt(e.point, tolerance * 1.5);
    if (grip) {
      // anchor at the grip's real position so coincident corners are found
      // exactly, not at the click point (which may be up to tolerance off)
      const entity = ctx.doc.get(grip.entityId);
      // an opening's end grips run along its wall: they resize it rather than
      // move a corner, so none of the corner machinery below applies
      if (entity instanceof HostedOpeningEntity && grip.index > 0) {
        this.mode = {
          kind: 'opening-resize',
          entityId: grip.entityId,
          index: grip.index,
        };
        this.previewOpening(e.point);
        this.ui.prompt.set('Drag to resize the opening');
        return;
      }
      const grips = entity && hasGrips(entity) ? entity.getGrips() : [];
      const gp = grips.find((g) => g.index === grip.index)?.point;
      // a two-grip wall/line gives an angle-snap reference: its fixed end
      const fixed =
        grips.length === 2
          ? (grips.find((g) => g.index !== grip.index)?.point ?? null)
          : null;
      this.mode = {
        kind: 'grip',
        ...grip,
        start: e.point,
        anchor: gp ?? e.point,
        fixed,
        stick: !e.modifiers.alt, // Alt = detach this corner, move it alone
      };
      this.ui.prompt.set('Drag the corner (Shift = 90°, Alt = detach)');
      return;
    }

    // 2) entity under cursor → select + arm drag
    const hit = this.topHit(e.point, tolerance);
    if (hit) {
      if (this.additive(e)) {
        ctx.selection.toggle(hit.id);
      } else if (!ctx.selection.has(hit.id)) {
        ctx.selection.clear();
        ctx.selection.add(hit.id);
      }
      // Gathering is picking, not moving. A thumb wanders a few pixels between
      // taps, and turning that into a drag would carry everything gathered so
      // far off across the plan. The mode is one tap away from being off, and
      // switching it off keeps the selection — so the move is still one tap
      // away too.
      if (gathering) return;
      const ids = ctx.selection.list();
      if (ids.length > 0)
        this.mode = { kind: 'maybe-drag', start: e.point, ids: [...ids] };
      return;
    }

    // 3) empty space → box selection
    this.mode = { kind: 'box', start: e.point, additive: this.additive(e) };
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
      case 'grip': {
        const m = this.mode;
        const to = this.resolveGrip(m, e);
        // dragged wall = dashed HUD line (its length + angle); the other walls
        // stuck to the corner = ghosts; live angle arcs at the affected corners
        this.ui.setRubber({
          a: m.fixed ?? m.anchor,
          b: to.point,
          angleLocked: to.locked,
        });
        const ghost = this.gripGhost(m, to.point, m.entityId);
        this.ui.setGhost(ghost.length > 0 ? ghost : null);
        this.ui.setGuides(to.guides.length > 0 ? to.guides : null);
        this.ui.setAngles(
          m.stick ? cornerAngles(ctx.doc, m.anchor, to.point) : null,
        );
        break;
      }
      case 'opening-resize':
        this.previewOpening(e.point);
        break;
      case 'room-resize': {
        const r = rectFrom(this.mode.fixed, e.point);
        const outline: Geometry = {
          kind: 'polyline',
          points: [
            { x: r.minX, y: r.minY },
            { x: r.maxX, y: r.minY },
            { x: r.maxX, y: r.maxY },
            { x: r.minX, y: r.maxY },
          ],
          closed: true,
        };
        this.ui.setGhost([outline]);
        break;
      }
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
    this.ui.setAngles(null);
    this.ui.setGuides(null);
    this.ui.setSnap(null);
    this.ui.setPending(null);

    switch (mode.kind) {
      case 'drag': {
        // the same snap the ghost previewed, so a room welds to the corner it
        // was shown catching instead of landing a few millimetres off
        const delta = this.dragSnap(mode, e.point).delta;
        if (delta.x !== 0 || delta.y !== 0) {
          // moving whole walls carries their joins: attached walls stretch to
          // follow (one undo). Any non-wall in the selection → plain translate.
          // Move-separately skips the carry entirely and just translates, so a
          // wall can be lifted out of a junction without dragging it about.
          const plan = this.ui.detachedMove.get()
            ? null
            : planStickyWallMove(ctx.doc, mode.ids, delta);
          if (plan) ctx.dispatch('GRIP.MOVEMANY', { moves: plan.moves });
          else ctx.dispatch('ENTITY.MOVE', { ids: mode.ids, delta });
        }
        break;
      }
      case 'grip': {
        // sticky corners: every endpoint welded to this one follows, so a
        // joined wall junction stretches together instead of tearing apart.
        // Alt at grab time detaches — then only this grip moves.
        const to = this.resolveGrip(mode, e).point;
        const grips = mode.stick
          ? this.coincidentGrips(mode.anchor)
          : [{ id: mode.entityId, index: mode.index }];
        if (grips.length > 1) {
          ctx.dispatch('GRIP.MOVEMANY', {
            moves: grips.map((g) => ({ ...g, to })),
          });
        } else {
          ctx.dispatch('GRIP.MOVE', {
            id: mode.entityId,
            index: mode.index,
            to,
          });
        }
        this.ui.prompt.set(this.restingPrompt());
        break;
      }
      case 'opening-resize': {
        // one grip move, so the width change and the centre shift that keeps
        // the far end put are one command and one undo
        const opening = ctx.doc.get(mode.entityId);
        if (opening instanceof HostedOpeningEntity) {
          const span = opening.planEndDrag(mode.index, e.point);
          // a tap on the grip resizes nothing — it must not cost an undo step
          if (span && (span.width !== opening.width || span.t !== opening.t)) {
            ctx.dispatch('GRIP.MOVE', {
              id: mode.entityId,
              index: mode.index,
              to: e.point,
            });
          }
        }
        this.ui.prompt.set(this.restingPrompt());
        break;
      }
      case 'room-resize':
        resizeRectRoomTo(
          (name, params) => ctx.dispatch(name, params),
          mode.room,
          rectFrom(mode.fixed, e.point),
        );
        this.ui.prompt.set(this.restingPrompt());
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
    this.ui.setAngles(null);
    this.ui.setGuides(null);
    this.ui.setPending(null);
    this.ctx?.selection.clear();
  }

  /** blinking band showing the opening the end grip would leave behind */
  private previewOpening(cursor: Point): void {
    const ctx = this.ctx;
    if (!ctx || this.mode.kind !== 'opening-resize') return;
    const opening = ctx.doc.get(this.mode.entityId);
    const span =
      opening instanceof HostedOpeningEntity
        ? opening.planEndDrag(this.mode.index, cursor)
        : null;
    this.ui.setPending(span ? { a: span.a, b: span.b } : null);
  }

  /**
   * Resolve the dragged corner's target: object snap wins, then Shift-ortho,
   * then object-snap tracking to other corners (dashed guides), then soft polar
   * angle snap relative to the wall's fixed end.
   */
  private resolveGrip(
    mode: Extract<Mode, { kind: 'grip' }>,
    e: ToolInputEvent,
  ): { point: Point; locked: boolean; guides: AlignGuide[] } {
    if (e.snapped) return { point: e.point, locked: false, guides: [] };
    if (mode.fixed && e.modifiers.shift) {
      const r = constrainAngle(mode.fixed, e.point, true);
      return { point: r.point, locked: r.locked, guides: [] };
    }
    const ctx = this.ctx;
    if (ctx) {
      const align = alignGuides(
        ctx.doc,
        e.point,
        this.getTolerance(),
        mode.anchor,
      );
      if (align.guides.length > 0) {
        return { point: align.point, locked: false, guides: align.guides };
      }
    }
    if (mode.fixed) {
      const r = constrainAngle(mode.fixed, e.point, e.modifiers.shift);
      return { point: r.point, locked: r.locked, guides: [] };
    }
    return { point: e.point, locked: false, guides: [] };
  }

  /**
   * Whether a drag started here would grab something (a room corner handle,
   * an entity grip, or a selected entity to move) rather than pan. Lets touch
   * input pick drag vs pan on one finger.
   */
  hitDraggable(point: Point, tolerance: number): boolean {
    const ctx = this.ctx;
    if (!ctx) return false;
    // Nothing is draggable while gathering, which leaves every gesture that is
    // not a tap free to pan. Gathering six walls on a 360 px screen means
    // reaching walls that are off it, and the alternative is a mode where the
    // plan cannot be moved wherever a finger happens to land on something
    // already selected.
    if (this.ui.multiSelect.get()) return false;
    const room = detectRectRoom(ctx.doc, ctx.selection.list());
    if (room) {
      for (const c of rectRoomCorners(room)) {
        if (distance(c, point) <= tolerance * 1.5) return true;
      }
    }
    if (this.gripAt(point, tolerance * 1.5)) return true;
    const hit = this.topHit(point, tolerance);
    return !!hit && ctx.selection.has(hit.id);
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

  /**
   * Boundary walls of the detected room containing the point, or null.
   *
   * Visible rooms only: tapping inside one selects its walls, and a room whose
   * sides are switched off would hand back a selection of things that are not
   * on the screen.
   *
   * And only walls this drag is allowed to edit. A room is derived geometry —
   * it is not an entity and carries no lock of its own — so tapping inside one
   * used to hand back its boundary whatever state those walls were in, which is
   * how a tap in the middle of a locked plan could put the whole original in
   * front of the Delete button. Selecting is the first step of editing, and the
   * same predicate that guards a tap ON a wall has to guard a tap between them.
   *
   * A part-locked room hands back only the walls you may actually edit. That is
   * honest: the rect-room detector will then not recognise the remainder as a
   * room, which is correct — a room you may not edit is not one you can resize.
   */
  private roomWallsAt(point: Point): EntityId[] | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    for (const space of detectSpaces(ctx.doc, null, { visibleOnly: true })) {
      if (
        space.boundaryWallIds.length === 0 ||
        !pointInLoop(point, space.boundary)
      )
        continue;
      const editable = space.boundaryWallIds.filter((id) => {
        const wall = ctx.doc.get(id);
        return !!wall && isEntityInteractive(ctx.doc, wall);
      });
      return editable.length > 0 ? editable : null;
    }
    return null;
  }

  /**
   * Dashed preview of the corner drag: each two-grip entity (wall/line) whose
   * endpoint follows the dragged corner, redrawn from its fixed end to the
   * cursor. Empty for other entities (the caller falls back to a rubber line).
   */
  private gripGhost(
    mode: Extract<Mode, { kind: 'grip' }>,
    cursor: Point,
    excludeId?: EntityId,
  ): Geometry[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const grips = mode.stick
      ? this.coincidentGrips(mode.anchor)
      : [{ id: mode.entityId, index: mode.index }];
    const ghost: Geometry[] = [];
    for (const { id, index } of grips) {
      if (excludeId && id === excludeId) continue;
      const entity = ctx.doc.get(id);
      if (!entity || !hasGrips(entity)) continue;
      const gs = entity.getGrips();
      if (gs.length !== 2) continue; // walls, lines — a clean single stretch
      const fixed = gs[index === 0 ? 1 : 0].point;
      ghost.push({ kind: 'segment', a: fixed, b: cursor });
    }
    return ghost;
  }

  /**
   * Every grippable endpoint sitting on the given corner (within the wall
   * join tolerance), across ALL entities — not just the selected one. Dragging
   * that corner moves them together so a joined junction stays joined.
   *
   * "All entities" still means all the ones this drag is allowed to move. A
   * locked wall is on the drawing but not yours to edit, and a hidden one is
   * not on the drawing at all — carrying either because something happened to
   * share its corner would edit through a lock, silently.
   */
  private coincidentGrips(anchor: Point): { id: EntityId; index: number }[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const out: { id: EntityId; index: number }[] = [];
    const area = bboxExpand(bboxFromPoints([anchor]), JOIN_TOLERANCE);
    for (const entity of ctx.doc.queryBBox(area)) {
      // an opening's ends are a width, not a junction: a window sitting flush
      // against a wall corner must not be stretched when that corner moves
      if (!hasGrips(entity) || entity instanceof HostedOpeningEntity) continue;
      if (!isEntityInteractive(ctx.doc, entity)) continue;
      for (const grip of entity.getGrips()) {
        if (distance(grip.point, anchor) <= JOIN_TOLERANCE) {
          out.push({ id: entity.id, index: grip.index });
        }
      }
    }
    return out;
  }

  /**
   * The grip under the point — the NEAREST one, not the first found: an
   * opening's end grips sit well inside a touch radius of its middle one, and
   * the end actually under the finger has to win.
   */
  private gripAt(
    point: Point,
    tolerance: number,
  ): { entityId: EntityId; index: number } | null {
    const ctx = this.ctx;
    if (!ctx) return null;
    let best: { entityId: EntityId; index: number; d: number } | null = null;
    for (const id of ctx.selection.list()) {
      const entity = ctx.doc.get(id);
      if (!entity || !hasGrips(entity)) continue;
      for (const grip of entity.getGrips()) {
        const d = distance(grip.point, point);
        if (d <= tolerance && (!best || d < best.d)) {
          best = { entityId: id, index: grip.index, d };
        }
      }
    }
    return best ? { entityId: best.entityId, index: best.index } : null;
  }

  /**
   * The translation a drag should apply: the raw cursor delta, pulled onto a
   * neighbouring corner or an alignment with one. Computed the same way for
   * the live ghost and for the commit, so what is previewed is what lands.
   */
  private dragSnap(mode: Extract<Mode, { kind: 'drag' }>, cursor: Point) {
    const ctx = this.ctx;
    const raw = sub(cursor, mode.start);
    if (!ctx) return { delta: raw, guides: [] as AlignGuide[], stuck: null };
    return planDragSnap(
      ctx.doc,
      new Set(mode.ids as unknown as string[]),
      raw,
      // a touch-sized catch: the same tolerance a tap uses to hit a grip
      this.getTolerance() * 1.5,
    );
  }

  private updateGhost(cursor: Point): void {
    const ctx = this.ctx;
    if (!ctx || this.mode.kind !== 'drag') return;
    const snap = this.dragSnap(this.mode, cursor);
    const delta = snap.delta;
    const m = translation(delta);
    const ghost: Geometry[] = this.mode.ids
      .map((id) => ctx.doc.get(id))
      .filter((ent): ent is Entity => ent !== null)
      .map((ent) => transformGeometry(ent.getEffectiveGeometry(), m));
    // attached walls stretching to follow the move — nothing follows when the
    // selection is being moved on its own
    if (!this.ui.detachedMove.get()) {
      const plan = planStickyWallMove(ctx.doc, this.mode.ids, delta);
      if (plan) {
        for (const g of plan.ghosts)
          ghost.push({ kind: 'segment', a: g.a, b: g.b });
      }
    }
    this.ui.setGhost(ghost);
    // feedback for where it will land: a marker on the corner it has caught,
    // or dashed tracking lines to whatever it is lining up with
    this.ui.setGuides(snap.guides.length > 0 ? snap.guides : null);
    this.ui.setSnap(
      snap.stuck
        ? {
            kind: 'endpoint',
            point: snap.stuck.point,
            entityId: snap.stuck.entityId,
          }
        : null,
    );
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
