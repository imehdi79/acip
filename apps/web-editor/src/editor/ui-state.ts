import type {
  Geometry,
  LayerId,
  LevelId,
  Point,
  SnapPoint,
} from '@acip/editor-core';
import { ValueStore } from './store';

export type ViewTab = 'plan' | '3d';

export type StarterMode = 'replace' | 'add';

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
  readonly rubber: { a: Point; b: Point } | null;
  /** translated preview geometry while drag-moving */
  readonly ghost: readonly Geometry[] | null;
  readonly box: SelectionBox | null;
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

const EMPTY_OVERLAY: OverlayState = {
  snap: null,
  rubber: null,
  ghost: null,
  box: null,
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
  readonly overlay = new ValueStore<OverlayState>(EMPTY_OVERLAY);
  /** true while the drafter agent is running (input disabled, viewport live) */
  readonly agentBusy = new ValueStore<boolean>(false);
  /** drafter chat panel: bubble collapsed vs conversation open */
  readonly agentChatOpen = new ValueStore<boolean>(false);
  readonly agentChat = new ValueStore<readonly ChatMessage[]>([]);
  readonly agentMode = new ValueStore<AgentMode>('drafter');
  /** entity mark labels ("W3") in the plan — auto-enabled when chat opens */
  readonly showMarks = new ValueStore<boolean>(false);
  /** starter modal (preset picker) — shown on first empty load and on New */
  readonly starterOpen = new ValueStore<boolean>(false);
  /** 'replace' = New/first-load resets the doc; 'add' = drop into current plan */
  readonly starterMode = new ValueStore<StarterMode>('replace');
  /** plan image traced under the drawing; null = none loaded */
  readonly underlay = new ValueStore<UnderlayState | null>(null);
  /** bumped to ask the 2D viewport to zoom-to-fit the drawing */
  readonly fitTick = new ValueStore<number>(0);

  /** request a zoom-to-fit (the viewport owns the camera + container size) */
  requestFit(): void {
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

  clearOverlay(): void {
    this.overlay.set(EMPTY_OVERLAY);
  }
}
