import { Suspense, lazy, useEffect, useState } from 'react';
import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCheck,
  IconMaximize,
} from '@tabler/icons-react';
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
import { AgentChat } from './components/agent-chat';
import { EstimateSheet } from './components/estimate-sheet';
import { UnderlayControls } from './components/underlay-controls';
import { StarterModal } from './components/starter-modal';
import { SketchControls } from './components/sketch-controls';
import { SketchDimensions } from './components/sketch-dimensions';
import { DynamicInput } from './components/dynamic-input';
import { RoomSheet } from './components/room-dimensions';
import { loadServerRates } from './rates';
import { serverUrl } from './agent';
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

  // published office rates replace the demo table once (offline keeps demo)
  useEffect(() => {
    void loadServerRates(serverUrl());
  }, []);

  // first load with nothing restored → offer the starter presets
  useEffect(() => {
    if (session.doc.count === 0) {
      runtime.ui.starterMode.set('replace');
      runtime.ui.starterOpen.set(true);
    }
  }, [session, runtime]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      ) {
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
      // dynamic input: while a drawing tool is active, digits/backspace set an
      // exact length (Backspace here instead of erasing the empty selection)
      if (
        runtime.ui.activeToolId.get() !== 'select' &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.metaKey &&
        (/^[0-9.]$/.test(e.key) || e.key === 'Backspace')
      ) {
        e.preventDefault();
        runtime.tools.key(e.key);
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const ids = session.selection.list();
        if (ids.length > 0) {
          try {
            session.dispatch('ENTITY.ERASE', { ids });
            session.selection.clear();
          } catch (err) {
            runtime.ui.appendLog(
              err instanceof Error ? err.message : String(err),
              'error',
            );
          }
        }
        return;
      }
      if (e.key === 'Escape' || e.key === 'Enter') runtime.tools.key(e.key);
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
          <div className="viewport-area">
            <ViewportArea />
            <FitControl />
            <ToolControls />
            <SketchControls />
            <SketchDimensions />
            <DynamicInput />
            <UnderlayControls />
            <RoomSheet />
            <EstimateSheet />
            <AgentChat />
          </div>
          <Panels />
        </div>
        <CommandLine />
        <StatusBar />
      </div>
      <StarterModal />
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

/** floating zoom-to-fit, plan tab only — keeps the drawing findable */
function FitControl() {
  const { ui } = useRuntime();
  const tab = useStoreValue(ui.viewTab);
  if (tab !== 'plan') return null;
  return (
    <button
      type="button"
      className="viewport-fit"
      title="Zoom to fit (frame the whole plan)"
      onClick={() => ui.requestFit()}
    >
      <IconMaximize size={18} stroke={1.75} />
    </button>
  );
}

/**
 * Mobile-only on-screen controls: undo/redo (no Ctrl+Z on a phone) and, while
 * a drawing tool is active, a Done button to stop it — so a stray tap doesn't
 * keep dropping walls with no way out.
 */
function ToolControls() {
  const session = useSession();
  const { ui, tools } = useRuntime();
  const tab = useStoreValue(ui.viewTab);
  const activeToolId = useStoreValue(ui.activeToolId);
  if (tab !== 'plan') return null;
  // free-draw has its own Done/Cancel (SketchControls); don't double it up
  const drawing = activeToolId !== 'select' && activeToolId !== 'sketch';
  return (
    <div className="tool-controls mobile-only">
      <button type="button" title="Undo" onClick={() => session.undo()}>
        <IconArrowBackUp size={18} stroke={1.75} />
      </button>
      <button type="button" title="Redo" onClick={() => session.redo()}>
        <IconArrowForwardUp size={18} stroke={1.75} />
      </button>
      {drawing && (
        <button
          type="button"
          className="tool-done"
          title="Done — stop drawing"
          onClick={() => {
            tools.key('Escape');
            tools.useById('select');
          }}
        >
          <IconCheck size={18} stroke={2} />
          Done
        </button>
      )}
    </div>
  );
}
