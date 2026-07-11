import { createContext, useContext } from 'react';
import type { EditorSession, ToolContext } from '@acip/editor-core';
import { EditorUi } from './ui-state';
import { ToolManager } from './tools/tool-manager';
import { SelectTool } from './tools/select-tool';
import { ChainedDrawTool } from './tools/chained-draw-tool';
import { HostedPlaceTool } from './tools/hosted-place-tool';

export interface EditorRuntime {
  readonly ui: EditorUi;
  readonly tools: ToolManager;
}

export function createRuntime(session: EditorSession): EditorRuntime {
  const ui = new EditorUi();
  const toolCtx: ToolContext = {
    doc: session.doc,
    selection: session.selection,
    snap: session.snap,
    dispatch: <R,>(name: string, params?: unknown): R => session.dispatch<R>(name, params),
  };
  const tools = new ToolManager(toolCtx, ui);
  const finish = () => tools.useById('select');
  const tolerance = () => tools.worldTolerance;
  tools.register(new SelectTool(ui, tolerance));
  tools.register(new ChainedDrawTool('line', 'LINE', 'LINE.ADD', ui, finish));
  tools.register(new ChainedDrawTool('wall', 'WALL', 'WALL.ADD', ui, finish));
  tools.register(new HostedPlaceTool('window', 'WINDOW', 'WINDOW.ADD', ui, tolerance, finish));
  tools.register(new HostedPlaceTool('door', 'DOOR', 'DOOR.ADD', ui, tolerance, finish));
  tools.useById('select');
  return { ui, tools };
}

export const RuntimeContext = createContext<EditorRuntime | null>(null);

export function useRuntime(): EditorRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside the editor');
  return runtime;
}
