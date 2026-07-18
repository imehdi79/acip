import { useEffect, useState } from 'react';
import type { EditorSession, EntityId } from '@acip/editor-core';

/** bumps once per committed/undone/redone transaction — chrome re-reads the doc */
export function useDocRevision(session: EditorSession): number {
  const [rev, setRev] = useState(0);
  useEffect(
    () => session.doc.events.on('change', () => setRev((r) => r + 1)),
    [session],
  );
  return rev;
}

export function useSelectionIds(session: EditorSession): readonly EntityId[] {
  const [ids, setIds] = useState<readonly EntityId[]>(() =>
    session.selection.list(),
  );
  useEffect(
    () => session.selection.events.on('changed', (list) => setIds(list)),
    [session],
  );
  return ids;
}
