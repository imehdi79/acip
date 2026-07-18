import type { EntityId, LayerId, LevelId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { StairEntity } from '../entities/architecture/stair-entity.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asPoint, asPositive } from './validate.js';

export interface AddStairParams {
  origin: Point;
  direction?: Point;
  width?: number;
  baseLevelId?: LevelId;
  topLevelId?: LevelId;
  height?: number;
  layerId?: LayerId;
}

export const AddStairCommand: Command<AddStairParams, EntityId> = {
  name: 'STAIR.ADD',
  description:
    'Create a straight-flight stair from origin along direction, connecting baseLevelId to ' +
    'topLevelId (or rising by height when no top level is given). Riser count and run length ' +
    'derive from the level-to-level rise and re-tread when a level moves. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddStairParams = {
        origin: asPoint(raw['origin'], 'origin'),
      };
      if (raw['direction'] !== undefined)
        params.direction = asPoint(raw['direction'], 'direction');
      if (raw['width'] !== undefined)
        params.width = asPositive(raw['width'], 'width');
      if (raw['baseLevelId'] !== undefined) {
        params.baseLevelId = asId(
          raw['baseLevelId'],
          'baseLevelId',
        ) as string as LevelId;
      }
      if (raw['topLevelId'] !== undefined) {
        params.topLevelId = asId(
          raw['topLevelId'],
          'topLevelId',
        ) as string as LevelId;
      }
      if (raw['height'] !== undefined)
        params.height = asPositive(raw['height'], 'height');
      if (raw['layerId'] !== undefined) {
        params.layerId = asId(raw['layerId'], 'layerId') as string as LayerId;
      }
      return params;
    },
    () =>
      S.object(
        {
          origin: S.point('start point (bottom of the flight)'),
          direction: S.point('run direction in plan (default {x:1,y:0})'),
          width: S.number('stair width in meters (default 1.0)'),
          baseLevelId: S.id(
            'bottom level id (default: unassigned, elevation 0)',
          ),
          topLevelId: S.id('top level id; its elevation sets the rise'),
          height: S.number(
            'flat rise in meters when no topLevelId is given (default 3)',
          ),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['origin'],
      ),
  ),
  execute(ctx, params) {
    if (
      params.baseLevelId !== undefined &&
      !ctx.doc.levels.has(params.baseLevelId)
    ) {
      throw new ValidationError(`level ${params.baseLevelId} does not exist`);
    }
    if (
      params.topLevelId !== undefined &&
      !ctx.doc.levels.has(params.topLevelId)
    ) {
      throw new ValidationError(`level ${params.topLevelId} does not exist`);
    }
    const stair = new StairEntity();
    stair.setRun(params.origin, params.direction ?? { x: 1, y: 0 });
    if (params.width !== undefined) stair.width = params.width;
    if (params.baseLevelId !== undefined)
      stair.baseLevelId = params.baseLevelId;
    stair.vertical =
      params.topLevelId !== undefined
        ? { topLevelId: params.topLevelId }
        : { height: params.height ?? 3 };
    if (params.layerId !== undefined) stair.layerId = params.layerId;
    ctx.tx.create(stair);
    return stair.id;
  },
};

export function registerStairCommands(registry: CommandRegistry): void {
  registry.register(AddStairCommand);
}
