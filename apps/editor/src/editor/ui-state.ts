import type {
  Geometry,
  LayerId,
  LevelId,
  Point,
  SnapPoint,
} from '@acip/editor-core';
import type { AlignGuide, AngleMark } from './tools/drafting';
import { ValueStore } from './store';

export type ViewTab = 'plan' | '3d';

export type StarterMode = 'replace' | 'add';

export interface FitBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface LogEntry {
  readonly text: string;
  readonly kind: 'info' | 'error' | 'echo';
}

export type ChatRole = 'user' | 'agent' | 'progress' | 'error';

/** drafter draws on request; estimator proposes and applies only on confirm */
export type AgentMode = 'drafter' | 'estimator';

export interface ChatMessage {
  readonly role: ChatRole;
  readonly text: string;
}

export interface SelectionBox {
  readonly a: Point;
  readonly b: Point;
  /** right-to-left drag = crossing selection (green dashed, touch counts) */
  readonly crossing: boolean;
}

export interface OverlayState {
  readonly snap: SnapPoint | null;
  /** live rubber-band line; angleLocked = its bearing is snapped to a clean angle */
  readonly rubber: { a: Point; b: Point; angleLocked?: boolean } | null;
  /** translated preview geometry while drag-moving */
  readonly ghost: readonly Geometry[] | null;
  readonly box: SelectionBox | null;
  /** freehand pen strokes (world points) while the free-draw tool is live */
  readonly ink: readonly (readonly Point[])[] | null;
  /** live corner-angle arcs while a corner is dragged */
  readonly angles: readonly AngleMark[] | null;
  /** dashed alignment/tracking lines to existing corners */
  readonly guides: readonly AlignGuide[] | null;
  /**
   * Provisional wall the finger is dragging out. Blinks, so a touch that has
   * registered is obvious before the drag has gone anywhere — on a phone there
   * is no cursor to say the tool is armed.
   *
   * `measured` prints the band's length next to it: a tool whose band IS the
   * size being chosen asks for it, one whose band only shows where something
   * will land does not.
   */
  readonly pending: { a: Point; b: Point; measured?: boolean } | null;
}

/** 2D camera snapshot so React overlays can place chrome at world points */
export interface CameraState {
  readonly scale: number;
  readonly offsetX: number;
  readonly offsetY: number;
}

/**
 * A raster plan image drawn under the drawing — the reference to trace over,
 * by hand or by the agent. Presentation state only (not part of the document,
 * not persisted): the drawn model stays the single source of truth.
 */
export interface UnderlayState {
  readonly image: HTMLImageElement;
  /** world position (meters) of the image's top-left corner */
  readonly anchor: Point;
  /** meters per image pixel — set by two-point calibration */
  readonly scale: number;
  readonly opacity: number;
}

/**
 * Danger-zone mode, while it is on. Everything drawn goes to `layerId` and
 * draws in its red; the rest of the plan is locked, so it can be seen and
 * snapped to but not edited.
 *
 * `returnLayerId` is the layer that was active before, so leaving the zone puts
 * new work back where it was going rather than on whatever was last used.
 */
export interface DangerZoneState {
  readonly layerId: LayerId;
  readonly returnLayerId: LayerId | null;
}

const EMPTY_OVERLAY: OverlayState = {
  snap: null,
  rubber: null,
  ghost: null,
  box: null,
  ink: null,
  angles: null,
  guides: null,
  pending: null,
};

/** Chrome-facing UI state; the viewport and tools write, React chrome subscribes. */
export class EditorUi {
  readonly coords = new ValueStore<Point | null>(null);
  readonly prompt = new ValueStore<string>('');
  readonly log = new ValueStore<readonly LogEntry[]>([]);
  readonly activeToolId = new ValueStore<string>('select');
  readonly viewTab = new ValueStore<ViewTab>('plan');
  /** null = "all levels"; new walls are assigned to the active level */
  readonly activeLevelId = new ValueStore<LevelId | null>(null);
  /** null = default layer; new entities land on the active layer */
  readonly activeLayerId = new ValueStore<LayerId | null>(null);
  /** null = off. See danger-zone.ts — nothing else may write this. */
  readonly dangerZone = new ValueStore<DangerZoneState | null>(null);
  readonly overlay = new ValueStore<OverlayState>(EMPTY_OVERLAY);
  /** true while the drafter agent is running (input disabled, viewport live) */
  readonly agentBusy = new ValueStore<boolean>(false);
  /** drafter chat panel: bubble collapsed vs conversation open */
  readonly agentChatOpen = new ValueStore<boolean>(false);
  readonly agentChat = new ValueStore<readonly ChatMessage[]>([]);
  readonly agentMode = new ValueStore<AgentMode>('drafter');
  /**
   * Move the selection on its OWN, leaving the walls joined to it where they
   * are. Off by default: dragging a wall normally carries its joins so a room
   * stays a room. On, a wall can be pulled out of a junction — the control you
   * want when a plan needs rearranging rather than reshaping.
   */
  readonly detachedMove = new ValueStore<boolean>(false);
  /** entity mark labels ("W3") in the plan — auto-enabled when chat opens */
  readonly showMarks = new ValueStore<boolean>(false);
  /** reveal demolition-phase work (tear-out finishes, openings to remove) on the plan */
  readonly showDemolition = new ValueStore<boolean>(false);
  /** price walls solid (توپر): openings are not deducted, costed as separate items */
  readonly solidWalls = new ValueStore<boolean>(false);
  /** starter modal (preset picker) — shown on first empty load and on New */
  readonly starterOpen = new ValueStore<boolean>(false);
  /** side panels open as a drawer on mobile (desktop always shows them) */
  readonly panelsOpen = new ValueStore<boolean>(false);
  /** 'replace' = New/first-load resets the doc; 'add' = drop into current plan */
  readonly starterMode = new ValueStore<StarterMode>('replace');
  /** plan image traced under the drawing; null = none loaded */
  readonly underlay = new ValueStore<UnderlayState | null>(null);
  /** finished freehand strokes waiting to be recognized (free-draw tool) */
  readonly sketchStrokes = new ValueStore<number>(0);
  /** walls just produced by free-draw — get floating per-wall length chips */
  readonly sketchWalls = new ValueStore<readonly string[]>([]);
  /** typed length while drawing (dynamic input); null = not typing */
  readonly draftLength = new ValueStore<string | null>(null);
  /** live 2D camera, published by the viewport for world→screen overlays */
  readonly camera = new ValueStore<CameraState>({
    scale: 60,
    offsetX: 0,
    offsetY: 0,
  });
  /** bumped to ask the 2D viewport to zoom-to-fit */
  readonly fitTick = new ValueStore<number>(0);
  /** optional target for the next fit; null = fit the whole drawing */
  readonly fitTarget = new ValueStore<FitBounds | null>(null);

  /**
   * Request a zoom-to-fit. With no argument the viewport frames the whole
   * drawing; with a bounds it frames just that (a room, from the rooms list).
   * The viewport owns the camera + container size, so this is a signal.
   */
  requestFit(target?: FitBounds): void {
    this.fitTarget.set(target ?? null);
    this.fitTick.set(this.fitTick.get() + 1);
  }

  appendLog(text: string, kind: LogEntry['kind'] = 'info'): void {
    this.log.set([...this.log.get().slice(-99), { text, kind }]);
  }

  appendChat(text: string, role: ChatRole = 'agent'): void {
    this.agentChat.set([...this.agentChat.get().slice(-199), { role, text }]);
  }

  setSnap(snap: SnapPoint | null): void {
    const cur = this.overlay.get();
    if (cur.snap === snap) return;
    this.overlay.set({ ...cur, snap });
  }

  setRubber(rubber: OverlayState['rubber']): void {
    this.overlay.set({ ...this.overlay.get(), rubber });
  }

  setGhost(ghost: OverlayState['ghost']): void {
    this.overlay.set({ ...this.overlay.get(), ghost });
  }

  setBox(box: OverlayState['box']): void {
    this.overlay.set({ ...this.overlay.get(), box });
  }

  setInk(ink: OverlayState['ink']): void {
    this.overlay.set({ ...this.overlay.get(), ink });
  }

  setAngles(angles: OverlayState['angles']): void {
    this.overlay.set({ ...this.overlay.get(), angles });
  }

  setGuides(guides: OverlayState['guides']): void {
    this.overlay.set({ ...this.overlay.get(), guides });
  }

  setPending(pending: OverlayState['pending']): void {
    this.overlay.set({ ...this.overlay.get(), pending });
  }

  clearOverlay(): void {
    this.overlay.set(EMPTY_OVERLAY);
  }
}
