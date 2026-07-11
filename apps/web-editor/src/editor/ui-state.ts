import type { Point, SnapPoint } from '@acip/editor-core';
import { ValueStore } from './store';

export type ViewTab = 'plan' | '3d';

export interface LogEntry {
  readonly text: string;
  readonly kind: 'info' | 'error' | 'echo';
}

export interface OverlayState {
  readonly snap: SnapPoint | null;
  readonly rubber: { a: Point; b: Point } | null;
}

const EMPTY_OVERLAY: OverlayState = { snap: null, rubber: null };

/** Chrome-facing UI state; the viewport and tools write, React chrome subscribes. */
export class EditorUi {
  readonly coords = new ValueStore<Point | null>(null);
  readonly prompt = new ValueStore<string>('');
  readonly log = new ValueStore<readonly LogEntry[]>([]);
  readonly activeToolId = new ValueStore<string>('select');
  readonly viewTab = new ValueStore<ViewTab>('plan');
  readonly overlay = new ValueStore<OverlayState>(EMPTY_OVERLAY);

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

  clearOverlay(): void {
    this.overlay.set(EMPTY_OVERLAY);
  }
}
