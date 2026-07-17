import { createContext, useContext } from 'react';
import type { EditorSession, MaterialId, ToolContext, TypeId } from '@acip/editor-core';
import { EditorUi } from './ui-state';
import { ToolManager } from './tools/tool-manager';
import { SelectTool } from './tools/select-tool';
import { ChainedDrawTool } from './tools/chained-draw-tool';
import { HostedPlaceTool } from './tools/hosted-place-tool';
import { ArcTool, CircleTool, PolylineTool } from './tools/circle-tool';
import { DimensionTool } from './tools/dim-tool';
import { SlabTool } from './tools/slab-tool';

export interface EditorRuntime {
  readonly ui: EditorUi;
  readonly tools: ToolManager;
}

/**
 * Demo catalog so quantities have materials to report against. Runs through
 * the command bus, then clears history so seeding isn't an undo step.
 * Each part skips itself when its type already exists (autosave restore,
 * opened file). Also called after "New" to keep the demo catalog available.
 */
export function seedCatalog(session: EditorSession): TypeId | null {
  try {
    if (session.doc.types.list('wall').length === 0) {
      const block = session.dispatch<MaterialId>('MATERIAL.ADD', {
        name: 'Concrete block',
        unit: 'm3',
        costCode: 'block',
      });
      const insulation = session.dispatch<MaterialId>('MATERIAL.ADD', {
        name: 'Insulation',
        unit: 'm3',
        costCode: 'insulation',
      });
      const plaster = session.dispatch<MaterialId>('MATERIAL.ADD', {
        name: 'Plaster',
        unit: 'm3',
        costCode: 'plaster',
      });
      session.dispatch<TypeId>('TYPE.ADD', {
        targetType: 'wall',
        name: 'Block 300 (20+5+5)',
        layers: [
          { materialId: block, thickness: 0.2 },
          { materialId: insulation, thickness: 0.05 },
          { materialId: plaster, thickness: 0.05 },
        ],
      });
    }
    if (session.doc.types.list('slab').length === 0) {
      const concrete = session.dispatch<MaterialId>('MATERIAL.ADD', {
        name: 'Concrete slab',
        unit: 'm3',
        costCode: 'concrete-slab',
      });
      const screed = session.dispatch<MaterialId>('MATERIAL.ADD', {
        name: 'Screed',
        unit: 'm3',
        costCode: 'screed',
      });
      session.dispatch<TypeId>('TYPE.ADD', {
        targetType: 'slab',
        name: 'Slab 200 (15+5)',
        layers: [
          { materialId: concrete, thickness: 0.15 },
          { materialId: screed, thickness: 0.05 },
        ],
      });
    }
    session.history.clear();
    return session.doc.types.list('wall')[0]?.id ?? null;
  } catch {
    return null;
  }
}

export function createRuntime(session: EditorSession): EditorRuntime {
  const ui = new EditorUi();
  seedCatalog(session);
  const toolCtx: ToolContext = {
    doc: session.doc,
    selection: session.selection,
    snap: session.snap,
    dispatch: <R,>(name: string, params?: unknown): R => session.dispatch<R>(name, params),
  };
  const tools = new ToolManager(toolCtx, ui);
  const finish = () => tools.useById('select');
  const tolerance = () => tools.worldTolerance;
  const activeLayer = () => {
    const layerId = ui.activeLayerId.get();
    return layerId ? { layerId } : {};
  };
  tools.register(new SelectTool(ui, tolerance));
  tools.register(new ChainedDrawTool('line', 'LINE', 'LINE.ADD', ui, finish, activeLayer));
  tools.register(new CircleTool(ui, finish, activeLayer));
  tools.register(new ArcTool(ui, finish, activeLayer));
  tools.register(new PolylineTool(ui, tolerance, finish, activeLayer));
  tools.register(
    new ChainedDrawTool('wall', 'WALL', 'WALL.ADD', ui, finish, () => {
      const levelId = ui.activeLevelId.get();
      // resolved live — New/Open replace the catalog under a running session
      const wallTypes = session.doc.types.list('wall');
      return {
        ...activeLayer(),
        ...(levelId ? { levelId } : {}),
        ...(wallTypes.length > 0 ? { typeId: wallTypes[0].id } : {}),
      };
    }),
  );
  tools.register(new HostedPlaceTool('window', 'WINDOW', 'WINDOW.ADD', ui, tolerance, finish));
  tools.register(new HostedPlaceTool('door', 'DOOR', 'DOOR.ADD', ui, tolerance, finish));
  tools.register(
    new SlabTool(ui, tolerance, finish, () => {
      const levelId = ui.activeLevelId.get();
      const slabTypes = session.doc.types.list('slab');
      return {
        ...activeLayer(),
        ...(levelId ? { levelId } : {}),
        ...(slabTypes.length > 0 ? { typeId: slabTypes[0].id } : {}),
      };
    }),
  );
  tools.register(
    new DimensionTool(ui, finish, () => {
      const levelId = ui.activeLevelId.get();
      return { ...activeLayer(), ...(levelId ? { levelId } : {}) };
    }),
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
