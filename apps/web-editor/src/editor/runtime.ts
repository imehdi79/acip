import { createContext, useContext } from 'react';
import type { EditorSession, MaterialId, ToolContext, TypeId } from '@acip/editor-core';
import { EditorUi } from './ui-state';
import { ToolManager } from './tools/tool-manager';
import { SelectTool } from './tools/select-tool';
import { ChainedDrawTool } from './tools/chained-draw-tool';
import { HostedPlaceTool } from './tools/hosted-place-tool';

export interface EditorRuntime {
  readonly ui: EditorUi;
  readonly tools: ToolManager;
  /** default wall type for new walls (seeded demo catalog) */
  readonly defaultWallTypeId: TypeId | null;
}

/**
 * Demo catalog so quantities have materials to report against. Runs through
 * the command bus, then clears history so seeding isn't an undo step.
 */
function seedCatalog(session: EditorSession): TypeId | null {
  if (session.doc.types.list('wall').length > 0) {
    return session.doc.types.list('wall')[0].id;
  }
  try {
    const block = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Concrete block', unit: 'm3' });
    const insulation = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Insulation', unit: 'm3' });
    const plaster = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Plaster', unit: 'm3' });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'wall',
      name: 'Block 300 (20+5+5)',
      layers: [
        { materialId: block, thickness: 0.2 },
        { materialId: insulation, thickness: 0.05 },
        { materialId: plaster, thickness: 0.05 },
      ],
    });
    session.history.clear();
    return typeId;
  } catch {
    return null;
  }
}

export function createRuntime(session: EditorSession): EditorRuntime {
  const ui = new EditorUi();
  const defaultWallTypeId = seedCatalog(session);
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
  tools.register(
    new ChainedDrawTool('wall', 'WALL', 'WALL.ADD', ui, finish, () => {
      const levelId = ui.activeLevelId.get();
      return {
        ...(levelId ? { levelId } : {}),
        ...(defaultWallTypeId ? { typeId: defaultWallTypeId } : {}),
      };
    }),
  );
  tools.register(new HostedPlaceTool('window', 'WINDOW', 'WINDOW.ADD', ui, tolerance, finish));
  tools.register(new HostedPlaceTool('door', 'DOOR', 'DOOR.ADD', ui, tolerance, finish));
  tools.useById('select');
  return { ui, tools, defaultWallTypeId };
}

export const RuntimeContext = createContext<EditorRuntime | null>(null);

export function useRuntime(): EditorRuntime {
  const runtime = useContext(RuntimeContext);
  if (!runtime) throw new Error('useRuntime must be used inside the editor');
  return runtime;
}
