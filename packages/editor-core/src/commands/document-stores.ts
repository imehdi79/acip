import type { LayerId, LevelId } from '../common/id.js';
import { newLayerId, newLevelId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import { isLevelAware } from '../entities/base/capabilities.js';
import type { Level } from '../document/levels/index.js';
import type { Layer } from '../document/layer.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { asId, asNumber } from './validate.js';

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

export function registerDocumentStoreCommands(registry: CommandRegistry): void {
  registry.register(AddLevelCommand);
  registry.register(UpdateLevelCommand);
  registry.register(RemoveLevelCommand);
  registry.register(AddLayerCommand);
}
