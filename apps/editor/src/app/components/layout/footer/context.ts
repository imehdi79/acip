import { useEffect, useState } from 'react';
import type { EditorSession } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import {
  useSettingsStore,
  type AppView,
} from '@/app/stores/global/settings.store';

/**
 * What is selected, coarsely. Footer buttons gate on the kind rather than on
 * entity types so a descriptor never has to know the document model.
 *
 * `room` is reserved: rooms are detected from walls, not stored as entities,
 * so nothing produces it yet.
 */
export type SelectionKind = 'none' | 'wall' | 'opening' | 'room' | 'mixed';

/** Everything the footer is allowed to decide on. */
export interface FooterContext {
  readonly view: AppView;
  readonly selection: SelectionKind;
  readonly count: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

function selectionKindOf(session: EditorSession): SelectionKind {
  let kind: SelectionKind | null = null;
  for (const id of session.selection.list()) {
    const type = session.doc.get(id)?.type;
    const next: SelectionKind =
      type === 'wall'
        ? 'wall'
        : type === 'window' || type === 'door'
          ? 'opening'
          : 'mixed';
    if (kind === null) kind = next;
    else if (kind !== next) return 'mixed';
  }
  return kind ?? 'none';
}

function snapshot(session: EditorSession, view: AppView): FooterContext {
  return {
    view,
    selection: selectionKindOf(session),
    count: session.selection.size,
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
  };
}

const same = (a: FooterContext, b: FooterContext): boolean =>
  a.view === b.view &&
  a.selection === b.selection &&
  a.count === b.count &&
  a.canUndo === b.canUndo &&
  a.canRedo === b.canRedo;

/**
 * Live footer context. `doc.change` fires on commit as well as on undo/redo,
 * so one subscription keeps canUndo/canRedo honest — but it also fires per
 * transaction during a grip drag, hence the equality guard before setState.
 */
export function useFooterContext(): FooterContext {
  const session = useSession();
  const view = useSettingsStore((state) => state.view);
  const [ctx, setCtx] = useState(() => snapshot(session, view));

  useEffect(() => {
    const sync = () =>
      setCtx((prev) => {
        const next = snapshot(session, view);
        return same(prev, next) ? prev : next;
      });

    sync(); // `view` changed, or we just mounted
    const unsubs = [
      session.selection.events.on('changed', sync),
      session.doc.events.on('change', sync),
    ];
    return () => {
      for (const off of unsubs) off();
    };
  }, [session, view]);

  return ctx;
}
