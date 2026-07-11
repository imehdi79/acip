import { Suspense, lazy, useEffect, useState } from 'react';
import { SessionProvider, useSession } from './session-context';
import { RuntimeContext, createRuntime, useRuntime } from './runtime';
import { useStoreValue } from './store';
import { Viewport2DView } from './viewport/viewport2d-view';

// three.js only loads when the 3D tab is first opened
const Viewer3D = lazy(() =>
  import('./viewport/viewer3d').then((m) => ({ default: m.Viewer3D })),
);
import { TopBar } from './components/top-bar';
import { ToolPalette } from './components/tool-palette';
import { CommandLine } from './components/command-line';
import { StatusBar } from './components/status-bar';
import { Panels } from './components/panels';
import './editor.css';

export function Editor() {
  return (
    <SessionProvider>
      <EditorShell />
    </SessionProvider>
  );
}

function EditorShell() {
  const session = useSession();
  const [runtime] = useState(() => createRuntime(session));

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) session.redo();
        else session.undo();
        return;
      }
      if (e.ctrlKey && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        session.redo();
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = session.selection.list();
        if (ids.length > 0) {
          try {
            session.dispatch('ENTITY.ERASE', { ids });
            session.selection.clear();
          } catch (err) {
            runtime.ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
          }
        }
        return;
      }
      if (e.key === 'Escape') runtime.tools.key('Escape');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, runtime]);

  return (
    <RuntimeContext.Provider value={runtime}>
      <div className="editor-shell">
        <TopBar />
        <div className="editor-main">
          <ToolPalette />
          <ViewportArea />
          <Panels />
        </div>
        <CommandLine />
        <StatusBar />
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
