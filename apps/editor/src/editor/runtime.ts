import { createContext, useContext } from 'react';
import type { EditorSession, ToolContext } from '@acip/editor-core';
import { EditorUi } from './ui-state';
import { ToolManager } from './tools/tool-manager';
import { SelectTool } from './tools/select-tool';
import { ChainedDrawTool } from './tools/chained-draw-tool';
import { HostedPlaceTool } from './tools/hosted-place-tool';
import { OVERLAPPING_COMMANDS, withResolvedWalls } from './walls';

export interface EditorRuntime {
  readonly ui: EditorUi;
  readonly tools: ToolManager;
}

/**
 * Editor runtime: UI state plus the registered tools. Select is the resting
 * tool — every draw tool returns to it when it finishes.
 */
export function createRuntime(session: EditorSession): EditorRuntime {
  const ui = new EditorUi();
  const toolCtx: ToolContext = {
    doc: session.doc,
    selection: session.selection,
    snap: session.snap,
    // Anything a tool does that can land two walls on one stretch — drawing
    // across a wall, dragging a copied room onto one, stretching an end into
    // one — is split at the crossing before the tool hands control back, so
    // the plan never holds the doubled state. One undo covers both.
    dispatch: <R>(name: string, params?: unknown): R =>
      OVERLAPPING_COMMANDS.has(name)
        ? withResolvedWalls(session, () => session.dispatch<R>(name, params))
        : session.dispatch<R>(name, params),
  };
  const tools = new ToolManager(toolCtx, ui);

  const finish = () => tools.useById('select');
  const tolerance = () => tools.worldTolerance;
  const activeLayer = () => {
    const layerId = ui.activeLayerId.get();
    return layerId ? { layerId } : {};
  };

  tools.register(new SelectTool(ui, tolerance));
  tools.register(
    new ChainedDrawTool(
      'wall',
      'WALL',
      'WALL.ADD',
      ui,
      finish,
      tolerance,
      () => {
        const levelId = ui.activeLevelId.get();
        // resolved live — New/Open replace the catalog under a running session
        const wallTypes = session.doc.types.list('wall');
        return {
          ...activeLayer(),
          ...(levelId ? { levelId } : {}),
          ...(wallTypes.length > 0 ? { typeId: wallTypes[0].id } : {}),
        };
      },
    ),
  );
  tools.register(
    new HostedPlaceTool(
      'window',
      'WINDOW',
      'WINDOW.ADD',
      ui,
      tolerance,
      finish,
    ),
  );
  tools.register(
    new HostedPlaceTool('door', 'DOOR', 'DOOR.ADD', ui, tolerance, finish),
  );
  tools.useById('select');

  return { ui, tools };
}

export const RuntimeContext = createContext<EditorRuntime | null>(null);

export function useRuntime(): EditorRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside the editor');
  return runtime;
}
