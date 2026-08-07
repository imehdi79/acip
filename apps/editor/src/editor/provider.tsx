import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { EditorSession } from '@acip/editor-core';
import { useSettingsStore } from '@/app/stores/global/settings.store';
import { SessionContext } from './session-context';
import { RuntimeContext, createRuntime } from './runtime';
import { generatePlan, type PlanTemplateId } from './templates';

/**
 * Owns the session and runtime for the whole signed-in shell, not just the
 * viewport: the footer sits outside <EditorView> and still needs to read
 * selection and history. Both are plain object graphs — no canvas, no DOM — so
 * building them at sign-in rather than at editor open costs nothing.
 */
export function EditorProvider({ children }: { children: ReactNode }) {
  const [session] = useState(() => new EditorSession());
  const [runtime] = useState(() => createRuntime(session));
  const template = useSettingsStore((state) => state.template);
  const view = useSettingsStore((state) => state.view);
  const generatedFor = useRef<PlanTemplateId | null>(null);

  // generatePlan calls newDocument(), which wipes the drawing. The session now
  // outlives the editor view, so without this guard every trip back from the
  // projects list would erase the user's work. Generate once per pick.
  useEffect(() => {
    if (!template || view !== 'editor') return;
    if (generatedFor.current === template) return;
    generatedFor.current = template;
    generatePlan(session, template);
    // The viewport subscribes in a child effect, which has already run.
    runtime.ui.requestFit();
  }, [session, runtime, template, view]);

  return (
    <SessionContext.Provider value={session}>
      <RuntimeContext.Provider value={runtime}>
        {children}
      </RuntimeContext.Provider>
    </SessionContext.Provider>
  );
}
