import { useEffect, useState } from 'react';
import type { EditorSession } from '@acip/editor-core';
import { classifySelection } from '@acip/editor-core';
import { useSession } from '@/editor/session-context';
import { useRuntime } from '@/editor/runtime';
import type { EditorUi } from '@/editor/ui-state';
import {
  useSettingsStore,
  type AppView,
} from '@/app/stores/global/settings.store';

/**
 * What is selected, coarsely. Apart from the reserved values this is the
 * entity's own type, so a footer button can gate on `'stair'` or `'roof'` the
 * day those become selectable — nothing here enumerates types.
 */
export type SelectionKind = 'none' | 'room' | 'mixed' | (string & {});

/** Everything the footer is allowed to decide on. */
export interface FooterContext {
  readonly view: AppView;
  readonly selection: SelectionKind;
  /** distinct entity types selected — for gating on a family, e.g. openings */
  readonly types: readonly string[];
  readonly count: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

function snapshot(
  session: EditorSession,
  ui: EditorUi,
  view: AppView,
): FooterContext {
  const info = classifySelection(
    session.doc,
    session.selection.list(),
    ui.activeLevelId.get(),
  );
  return {
    view,
    selection: info.kind,
    types: info.types,
    count: info.count,
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
  };
}

const sameTypes = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((t, i) => t === b[i]);

const same = (a: FooterContext, b: FooterContext): boolean =>
  a.view === b.view &&
  a.selection === b.selection &&
  a.count === b.count &&
  a.canUndo === b.canUndo &&
  a.canRedo === b.canRedo &&
  sameTypes(a.types, b.types);

/**
 * Live footer context. `doc.change` fires on commit as well as on undo/redo,
 * so one subscription keeps canUndo/canRedo honest — but it also fires per
 * transaction during a grip drag, hence the equality guard before setState.
 */
export function useFooterContext(): FooterContext {
  const session = useSession();
  const { ui } = useRuntime();
  const view = useSettingsStore((state) => state.view);
  const [ctx, setCtx] = useState(() => snapshot(session, ui, view));

  useEffect(() => {
    const sync = () =>
      setCtx((prev) => {
        const next = snapshot(session, ui, view);
        return same(prev, next) ? prev : next;
      });

    sync(); // `view` changed, or we just mounted
    const unsubs = [
      session.selection.events.on('changed', sync),
      session.doc.events.on('change', sync),
      ui.activeLevelId.subscribe(sync),
    ];
    return () => {
      for (const off of unsubs) off();
    };
  }, [session, ui, view]);

  return ctx;
}
