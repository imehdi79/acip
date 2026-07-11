import type { LayerId, LevelId, MaterialId, TypeId } from '../common/id.js';
import { newLayerId, newLevelId, newMaterialId, newTypeId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import { isLevelAware } from '../entities/base/capabilities.js';
import type { Level } from '../document/levels/index.js';
import type { Layer } from '../document/layer.js';
import type { Material, MaterialUnit } from '../document/materials/index.js';
import type { AssemblyLayer, EntityTypeDef } from '../document/types/index.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { asId, asNumber, asPositive } from './validate.js';

const MATERIAL_UNITS: readonly MaterialUnit[] = ['m', 'm2', 'm3', 'count'];

function asName(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${label} must be a non-empty string`);
  }
  return value.trim();
}

export interface AddLevelParams {
  name: string;
  elevation: number;
}

export const AddLevelCommand: Command<AddLevelParams, LevelId> = {
  name: 'LEVEL.ADD',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      name: asName(raw['name'], 'name'),
      elevation: asNumber(raw['elevation'], 'elevation'),
    };
  }),
  execute(ctx, params) {
    const level: Level = { id: newLevelId(), name: params.name, elevation: params.elevation };
    ctx.tx.storeAdd('levels', level);
    return level.id;
  },
};

export interface UpdateLevelParams {
  id: LevelId;
  name?: string;
  elevation?: number;
}

export const UpdateLevelCommand: Command<UpdateLevelParams, void> = {
  name: 'LEVEL.UPDATE',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const params: UpdateLevelParams = { id: asId(raw['id'], 'id') as string as LevelId };
    if (raw['name'] !== undefined) params.name = asName(raw['name'], 'name');
    if (raw['elevation'] !== undefined) params.elevation = asNumber(raw['elevation'], 'elevation');
    if (params.name === undefined && params.elevation === undefined) {
      throw new ValidationError('provide name and/or elevation');
    }
    return params;
  }),
  execute(ctx, params) {
    ctx.tx.storeUpdate<Level>('levels', params.id, (level) => {
      if (params.name !== undefined) level.name = params.name;
      if (params.elevation !== undefined) level.elevation = params.elevation;
    });
  },
};

export interface RemoveLevelParams {
  id: LevelId;
}

export const RemoveLevelCommand: Command<RemoveLevelParams, void> = {
  name: 'LEVEL.REMOVE',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return { id: asId(raw['id'], 'id') as string as LevelId };
  }),
  execute(ctx, params) {
    const inUse = ctx.doc.all().some((e) => isLevelAware(e) && e.baseLevelId === params.id);
    if (inUse) {
      throw new ValidationError(`level ${params.id} is in use by entities`);
    }
    ctx.tx.storeRemove('levels', params.id);
  },
};

export interface AddLayerParams {
  name: string;
}

export const AddLayerCommand: Command<AddLayerParams, LayerId> = {
  name: 'LAYER.ADD',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return { name: asName(raw['name'], 'name') };
  }),
  execute(ctx, params) {
    const layer: Layer = { id: newLayerId(), name: params.name, visible: true, locked: false };
    ctx.tx.storeAdd('layers', layer);
    return layer.id;
  },
};

export interface AddMaterialParams {
  name: string;
  unit?: MaterialUnit;
  hatch?: string;
}

export const AddMaterialCommand: Command<AddMaterialParams, MaterialId> = {
  name: 'MATERIAL.ADD',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const params: AddMaterialParams = { name: asName(raw['name'], 'name') };
    if (raw['unit'] !== undefined) {
      if (!MATERIAL_UNITS.includes(raw['unit'] as MaterialUnit)) {
        throw new ValidationError(`unit must be one of ${MATERIAL_UNITS.join(', ')}`);
      }
      params.unit = raw['unit'] as MaterialUnit;
    }
    if (raw['hatch'] !== undefined) params.hatch = asName(raw['hatch'], 'hatch');
    return params;
  }),
  execute(ctx, params) {
    const material: Material = {
      id: newMaterialId(),
      name: params.name,
      unit: params.unit ?? 'm3',
    };
    if (params.hatch !== undefined) material.hatch = params.hatch;
    ctx.tx.storeAdd('materials', material);
    return material.id;
  },
};

export interface AddTypeParams {
  targetType: string;
  name: string;
  layers?: AssemblyLayer[];
}

export const AddTypeCommand: Command<AddTypeParams, TypeId> = {
  name: 'TYPE.ADD',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const params: AddTypeParams = {
      targetType: asName(raw['targetType'], 'targetType'),
      name: asName(raw['name'], 'name'),
    };
    if (raw['layers'] !== undefined) {
      if (!Array.isArray(raw['layers'])) {
        throw new ValidationError('layers must be an array');
      }
      params.layers = raw['layers'].map((layer, i) => {
        const l = layer as Record<string, unknown>;
        return {
          materialId: asId(l['materialId'], `layers[${i}].materialId`) as string as MaterialId,
          thickness: asPositive(l['thickness'], `layers[${i}].thickness`),
        };
      });
    }
    return params;
  }),
  execute(ctx, params) {
    if (params.layers) {
      for (const layer of params.layers) {
        if (!ctx.doc.materials.has(layer.materialId)) {
          throw new ValidationError(`material ${layer.materialId} does not exist`);
        }
      }
    }
    const def: EntityTypeDef = {
      id: newTypeId(),
      targetType: params.targetType,
      name: params.name,
    };
    if (params.layers) def.layers = params.layers;
    ctx.tx.storeAdd('types', def);
    return def.id;
  },
};

export function registerDocumentStoreCommands(registry: CommandRegistry): void {
  registry.register(AddLevelCommand);
  registry.register(UpdateLevelCommand);
  registry.register(RemoveLevelCommand);
  registry.register(AddLayerCommand);
  registry.register(AddMaterialCommand);
  registry.register(AddTypeCommand);
}
