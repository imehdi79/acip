import type { LayerId, LevelId, MaterialId, TypeId } from '../common/id.js';
import { newLayerId, newLevelId, newMaterialId, newTypeId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import { isLevelAware } from '../entities/base/capabilities.js';
import type { Level } from '../document/levels/index.js';
import type { Layer } from '../document/layer.js';
import { DEFAULT_LAYER_ID } from '../document/layer.js';
import type { Material, MaterialUnit } from '../document/materials/index.js';
import type { AssemblyLayer, EntityTypeDef } from '../document/types/index.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
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
  description: 'Create a level (floor datum) at an elevation. Returns the new level id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      return {
        name: asName(raw['name'], 'name'),
        elevation: asNumber(raw['elevation'], 'elevation'),
      };
    },
    () =>
      S.object(
        {
          name: S.string('level name, e.g. "Ground floor"'),
          elevation: S.number('elevation above origin in meters'),
        },
        ['name', 'elevation'],
      ),
  ),
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
  description:
    'Rename a level and/or change its elevation. Entities on the level move vertically with it.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: UpdateLevelParams = { id: asId(raw['id'], 'id') as string as LevelId };
      if (raw['name'] !== undefined) params.name = asName(raw['name'], 'name');
      if (raw['elevation'] !== undefined) params.elevation = asNumber(raw['elevation'], 'elevation');
      if (params.name === undefined && params.elevation === undefined) {
        throw new ValidationError('provide name and/or elevation');
      }
      return params;
    },
    () =>
      S.object(
        {
          id: S.id('level id'),
          name: S.string('new name'),
          elevation: S.number('new elevation in meters'),
        },
        ['id'],
      ),
  ),
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
  description: 'Delete a level. Fails while any entity still references it.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      return { id: asId(raw['id'], 'id') as string as LevelId };
    },
    () => S.object({ id: S.id('level id') }, ['id']),
  ),
  execute(ctx, params) {
    const inUse = ctx.doc.all().some((e) => isLevelAware(e) && e.baseLevelId === params.id);
    if (inUse) {
      throw new ValidationError(`level ${params.id} is in use by entities`);
    }
    ctx.tx.storeRemove('levels', params.id);
  },
};

export interface DuplicateLevelParams {
  sourceLevelId: LevelId;
  name: string;
  elevation: number;
}

export const DuplicateLevelCommand: Command<DuplicateLevelParams, LevelId> = {
  name: 'LEVEL.DUPLICATE',
  description:
    'Copy a whole floor: creates a new level at the given elevation and clones every entity on the source level, including hosted windows/doors with their placements. Returns the new level id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      return {
        sourceLevelId: asId(raw['sourceLevelId'], 'sourceLevelId') as string as LevelId,
        name: asName(raw['name'], 'name'),
        elevation: asNumber(raw['elevation'], 'elevation'),
      };
    },
    () =>
      S.object(
        {
          sourceLevelId: S.id('level to copy from'),
          name: S.string('name for the new level'),
          elevation: S.number('elevation of the new level in meters'),
        },
        ['sourceLevelId', 'name', 'elevation'],
      ),
  ),
  execute(ctx, params) {
    if (!ctx.doc.levels.has(params.sourceLevelId)) {
      throw new ValidationError(`level ${params.sourceLevelId} does not exist`);
    }
    const level: Level = { id: newLevelId(), name: params.name, elevation: params.elevation };
    ctx.tx.storeAdd('levels', level);

    for (const entity of ctx.doc.all()) {
      if (!isLevelAware(entity) || entity.baseLevelId !== params.sourceLevelId) continue;
      const copy = entity.clone();
      if (isLevelAware(copy)) copy.baseLevelId = level.id;
      ctx.tx.create(copy);
      // hosted entities (windows, doors) follow their host onto the new floor
      for (const relation of ctx.doc.relations.relationsOfHost(entity.id)) {
        const hosted = ctx.doc.get(relation.hostedId);
        if (!hosted) continue;
        const hostedCopy = hosted.clone();
        ctx.tx.create(hostedCopy);
        ctx.tx.attach(copy.id, hostedCopy.id, relation.anchorIndex, { ...relation.params });
      }
    }
    return level.id;
  },
};

export interface AddLayerParams {
  name: string;
  color?: string;
}

export const AddLayerCommand: Command<AddLayerParams, LayerId> = {
  name: 'LAYER.ADD',
  description: 'Create a drawing layer. Returns the new layer id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddLayerParams = { name: asName(raw['name'], 'name') };
      if (raw['color'] !== undefined) params.color = asName(raw['color'], 'color');
      return params;
    },
    () =>
      S.object(
        {
          name: S.string('layer name'),
          color: S.string('optional CSS stroke color, e.g. "#e0b34d"'),
        },
        ['name'],
      ),
  ),
  execute(ctx, params) {
    const layer: Layer = { id: newLayerId(), name: params.name, visible: true, locked: false };
    if (params.color !== undefined) layer.color = params.color;
    ctx.tx.storeAdd('layers', layer);
    return layer.id;
  },
};

export interface UpdateLayerParams {
  id: LayerId;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  color?: string;
}

export const UpdateLayerCommand: Command<UpdateLayerParams, void> = {
  name: 'LAYER.UPDATE',
  description:
    'Rename a layer, toggle visibility (hidden entities disappear from render and snap) or lock (locked entities cannot be selected), or set its color.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: UpdateLayerParams = { id: asId(raw['id'], 'id') as string as LayerId };
      if (raw['name'] !== undefined) params.name = asName(raw['name'], 'name');
      if (raw['visible'] !== undefined) {
        if (typeof raw['visible'] !== 'boolean') throw new ValidationError('visible must be boolean');
        params.visible = raw['visible'];
      }
      if (raw['locked'] !== undefined) {
        if (typeof raw['locked'] !== 'boolean') throw new ValidationError('locked must be boolean');
        params.locked = raw['locked'];
      }
      if (raw['color'] !== undefined) params.color = asName(raw['color'], 'color');
      if (
        params.name === undefined &&
        params.visible === undefined &&
        params.locked === undefined &&
        params.color === undefined
      ) {
        throw new ValidationError('provide name, visible, locked, and/or color');
      }
      return params;
    },
    () =>
      S.object(
        {
          id: S.id('layer id'),
          name: S.string('new name'),
          visible: S.boolean('show/hide the layer'),
          locked: S.boolean('lock/unlock the layer'),
          color: S.string('CSS stroke color'),
        },
        ['id'],
      ),
  ),
  execute(ctx, params) {
    ctx.tx.storeUpdate<Layer>('layers', params.id, (layer) => {
      if (params.name !== undefined) layer.name = params.name;
      if (params.visible !== undefined) layer.visible = params.visible;
      if (params.locked !== undefined) layer.locked = params.locked;
      if (params.color !== undefined) layer.color = params.color;
    });
  },
};

export interface RemoveLayerParams {
  id: LayerId;
}

export const RemoveLayerCommand: Command<RemoveLayerParams, void> = {
  name: 'LAYER.REMOVE',
  description: 'Delete a layer. Fails for the default layer or while entities still use it.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      return { id: asId(raw['id'], 'id') as string as LayerId };
    },
    () => S.object({ id: S.id('layer id') }, ['id']),
  ),
  execute(ctx, params) {
    if (params.id === DEFAULT_LAYER_ID) {
      throw new ValidationError('the default layer cannot be removed');
    }
    if (ctx.doc.all().some((e) => e.layerId === params.id)) {
      throw new ValidationError(`layer ${params.id} is in use by entities`);
    }
    ctx.tx.storeRemove('layers', params.id);
  },
};

export interface AddMaterialParams {
  name: string;
  unit?: MaterialUnit;
  hatch?: string;
  costCode?: string;
}

export const AddMaterialCommand: Command<AddMaterialParams, MaterialId> = {
  name: 'MATERIAL.ADD',
  description:
    'Add a material to the library (used by type-catalog assembly layers and quantity takeoff). Returns the new material id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddMaterialParams = { name: asName(raw['name'], 'name') };
      if (raw['unit'] !== undefined) {
        if (!MATERIAL_UNITS.includes(raw['unit'] as MaterialUnit)) {
          throw new ValidationError(`unit must be one of ${MATERIAL_UNITS.join(', ')}`);
        }
        params.unit = raw['unit'] as MaterialUnit;
      }
      if (raw['hatch'] !== undefined) params.hatch = asName(raw['hatch'], 'hatch');
      if (raw['costCode'] !== undefined) params.costCode = asName(raw['costCode'], 'costCode');
      return params;
    },
    () =>
      S.object(
        {
          name: S.string('material name, e.g. "Concrete block"'),
          unit: S.enum(MATERIAL_UNITS, 'measurement unit (default m3)'),
          hatch: S.string('optional 2D hatch pattern name'),
          costCode: S.string('optional cost-item key for estimator rate tables'),
        },
        ['name'],
      ),
  ),
  execute(ctx, params) {
    const material: Material = {
      id: newMaterialId(),
      name: params.name,
      unit: params.unit ?? 'm3',
    };
    if (params.hatch !== undefined) material.hatch = params.hatch;
    if (params.costCode !== undefined) material.costCode = params.costCode;
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
  description:
    'Add an entity type to the catalog, e.g. a wall type with material assembly layers whose thicknesses sum to the wall thickness. Returns the new type id.',
  params: paramsSchema(
    (input) => {
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
    },
    () =>
      S.object(
        {
          targetType: S.string('entity type this applies to, e.g. "wall"'),
          name: S.string('catalog name, e.g. "Block 300 (20+5+5)"'),
          layers: S.array(
            S.object(
              {
                materialId: S.id('material id from the library'),
                thickness: S.number('layer thickness in meters'),
              },
              ['materialId', 'thickness'],
            ),
            'assembly layers, outermost first',
          ),
        },
        ['targetType', 'name'],
      ),
  ),
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
  registry.register(DuplicateLevelCommand);
  registry.register(AddLayerCommand);
  registry.register(UpdateLayerCommand);
  registry.register(RemoveLayerCommand);
  registry.register(AddMaterialCommand);
  registry.register(AddTypeCommand);
}
