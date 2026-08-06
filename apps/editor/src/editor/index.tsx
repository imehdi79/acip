import { Suspense, lazy, useEffect, useState } from 'react';
import { SessionProvider, useSession } from './session-context';
import { RuntimeContext, createRuntime, useRuntime } from './runtime';
import { useStoreValue } from './store';
import { Viewport2DView } from './viewport/viewport2d-view';
import { generatePlan, type PlanTemplateId } from './templates';
import './editor.css';

// three.js only loads when the 3D tab is first opened
const Viewer3D = lazy(() =>
  import('./viewport/viewer3d').then((m) => ({ default: m.Viewer3D })),
);

/**
 * Base editor surface ported from web-editor: the interactive 2D plan
 * (full runtime + tools) and a simple read-only 3D viewer. Opens in 2D.
 */
export interface EditorViewProps {
  /** Starter plan to generate on open. Omit to leave the document untouched. */
  template?: PlanTemplateId | null;
}

export function EditorView({ template }: EditorViewProps = {}) {
  return (
    <SessionProvider>
      <EditorShell template={template} />
    </SessionProvider>
  );
}

function EditorShell({ template }: EditorViewProps) {
  const session = useSession();
  const [runtime] = useState(() => createRuntime(session));

  useEffect(() => {
    if (!template) return;
    generatePlan(session, template);
    // The viewport subscribes in a child effect, which has already run.
    runtime.ui.requestFit();
  }, [session, runtime, template]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <div className="editor-view">
        <ViewportArea />
        <ViewToggle />
      </div>
    </RuntimeContext.Provider>
  );
}

function ViewportArea() {
  const { ui } = useRuntime();
  const tab = useStoreValue(ui.viewTab);
  if (tab === 'plan') return <Viewport2DView />;
  return (
    <Suspense fallback={<div className="viewport" />}>
      <Viewer3D />
    </Suspense>
  );
}

function ViewToggle() {
  const { ui } = useRuntime();
  const tab = useStoreValue(ui.viewTab);
  return (
    <div className="view-toggle">
      <button
        type="button"
        data-active={tab === 'plan'}
        onClick={() => ui.viewTab.set('plan')}
      >
        2D
      </button>
      <button
        type="button"
        data-active={tab === '3d'}
        onClick={() => ui.viewTab.set('3d')}
      >
        3D
      </button>
    </div>
  );
}

export default EditorView;
