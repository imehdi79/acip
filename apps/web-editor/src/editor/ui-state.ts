import type { Geometry, LayerId, LevelId, Point, SnapPoint } from '@acip/editor-core';
import { ValueStore } from './store';

export type ViewTab = 'plan' | '3d';

export interface LogEntry {
  readonly text: string;
  readonly kind: 'info' | 'error' | 'echo';
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

const EMPTY_OVERLAY: OverlayState = { snap: null, rubber: null, ghost: null, box: null };

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

  appendLog(text: string, kind: LogEntry['kind'] = 'info'): void {
    this.log.set([...this.log.get().slice(-99), { text, kind }]);
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
