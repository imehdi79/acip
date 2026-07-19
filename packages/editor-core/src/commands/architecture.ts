import type { EntityId, LayerId, LevelId, TypeId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { isHost } from '../entities/base/capabilities.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { WindowEntity } from '../entities/architecture/window-entity.js';
import { DoorEntity } from '../entities/architecture/door-entity.js';
import { HostedOpeningEntity } from '../entities/architecture/hosted-opening.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asNumber, asPoint, asPositive } from './validate.js';

export interface AddWallParams {
  a: Point;
  b: Point;
  thickness?: number;
  height?: number;
  levelId?: LevelId;
  typeId?: TypeId;
  layerId?: LayerId;
}

export const AddWallCommand: Command<AddWallParams, EntityId> = {
  name: 'WALL.ADD',
  description:
    'Create a wall along a baseline from a to b. Walls sharing endpoints auto-join their corners. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddWallParams = {
        a: asPoint(raw['a'], 'a'),
        b: asPoint(raw['b'], 'b'),
      };
      if (raw['thickness'] !== undefined)
        params.thickness = asPositive(raw['thickness'], 'thickness');
      if (raw['height'] !== undefined)
        params.height = asPositive(raw['height'], 'height');
      if (raw['levelId'] !== undefined)
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      if (raw['typeId'] !== undefined)
        params.typeId = asId(raw['typeId'], 'typeId') as string as TypeId;
      if (raw['layerId'] !== undefined)
        params.layerId = asId(raw['layerId'], 'layerId') as string as LayerId;
      return params;
    },
    () =>
      S.object(
        {
          a: S.point('baseline start'),
          b: S.point('baseline end'),
          thickness: S.number(
            'wall thickness in meters (default 0.3; ignored when typeId has assembly layers)',
          ),
          height: S.number('wall height in meters (default 3)'),
          levelId: S.id('optional level (floor) id the wall sits on'),
          typeId: S.id(
            'optional wall type id from the type catalog; thickness then derives from its assembly layers',
          ),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['a', 'b'],
      ),
  ),
  execute(ctx, params) {
    if (params.typeId !== undefined && !ctx.doc.types.has(params.typeId)) {
      throw new ValidationError(`type ${params.typeId} does not exist`);
    }
    const wall = new WallEntity();
    wall.setBaseline(params.a, params.b);
    if (params.thickness !== undefined) wall.thickness = params.thickness;
    if (params.height !== undefined) wall.vertical = { height: params.height };
    if (params.levelId !== undefined) wall.baseLevelId = params.levelId;
    if (params.typeId !== undefined) wall.typeRef = params.typeId;
    if (params.layerId !== undefined) wall.layerId = params.layerId;
    ctx.tx.create(wall);
    return wall.id;
  },
};

export interface AddWindowParams {
  wallId: EntityId;
  t: number;
  width?: number;
  sill?: number;
  height?: number;
}

export const AddWindowCommand: Command<AddWindowParams, EntityId> = {
  name: 'WINDOW.ADD',
  description:
    'Place a window in a wall at parametric position t along its baseline. The window follows the wall when it moves. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      return {
        wallId: asId(raw['wallId'], 'wallId'),
        t: asNumber(raw['t'], 't'),
        width: asPositive(raw['width'], 'width', 1.0),
        sill: asNumber(raw['sill'], 'sill', 0.9),
        height: asPositive(raw['height'], 'height', 1.2),
      };
    },
    () =>
      S.object(
        {
          wallId: S.id('id of the host wall'),
          t: S.number('position along the wall baseline, 0 = start, 1 = end'),
          width: S.number('opening width in meters (default 1.0)'),
          sill: S.number(
            'sill height above the wall base in meters (default 0.9)',
          ),
          height: S.number('opening height in meters (default 1.2)'),
        },
        ['wallId', 't'],
      ),
  ),
  execute(ctx, params) {
    const host = ctx.doc.get(params.wallId);
    if (!host || !isHost(host)) {
      throw new ValidationError(
        `wallId ${params.wallId} does not reference a host entity`,
      );
    }
    const window = new WindowEntity();
    window.t = Math.min(1, Math.max(0, params.t));
    if (params.width !== undefined) window.width = params.width;
    if (params.sill !== undefined) window.sill = params.sill;
    if (params.height !== undefined) window.height = params.height;
    ctx.tx.create(window);
    ctx.tx.attach(host.id, window.id, 0, {});
    return window.id;
  },
};

export interface AddDoorParams {
  wallId: EntityId;
  t: number;
  width?: number;
  height?: number;
  swing?: 1 | -1;
}

export const AddDoorCommand: Command<AddDoorParams, EntityId> = {
  name: 'DOOR.ADD',
  description:
    'Place a door in a wall at parametric position t along its baseline (sill is always 0). Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddDoorParams = {
        wallId: asId(raw['wallId'], 'wallId'),
        t: asNumber(raw['t'], 't'),
        width: asPositive(raw['width'], 'width', 0.9),
        height: asPositive(raw['height'], 'height', 2.1),
      };
      if (raw['swing'] !== undefined) {
        if (raw['swing'] !== 1 && raw['swing'] !== -1) {
          throw new ValidationError('swing must be 1 or -1');
        }
        params.swing = raw['swing'];
      }
      return params;
    },
    () =>
      S.object(
        {
          wallId: S.id('id of the host wall'),
          t: S.number('position along the wall baseline, 0 = start, 1 = end'),
          width: S.number('door width in meters (default 0.9)'),
          height: S.number('door height in meters (default 2.1)'),
          swing: S.enum(
            [1, -1],
            'swing direction relative to the wall normal (default 1)',
          ),
        },
        ['wallId', 't'],
      ),
  ),
  execute(ctx, params) {
    const host = ctx.doc.get(params.wallId);
    if (!host || !isHost(host)) {
      throw new ValidationError(
        `wallId ${params.wallId} does not reference a host entity`,
      );
    }
    const door = new DoorEntity();
    door.t = Math.min(1, Math.max(0, params.t));
    if (params.width !== undefined) door.width = params.width;
    if (params.height !== undefined) door.height = params.height;
    if (params.swing !== undefined) door.swing = params.swing;
    ctx.tx.create(door);
    ctx.tx.attach(host.id, door.id, 0, {});
    return door.id;
  },
};

export interface MoveOpeningParams {
  id: EntityId;
  t: number;
}

/**
 * The parametric move "move the window to a quarter of the wall" asks for.
 * Without it, agents fall back to delta/grip moves they must derive from
 * geometry they cannot see — the classic retry-loop trap.
 */
export const MoveOpeningCommand: Command<MoveOpeningParams, void> = {
  name: 'OPENING.MOVE',
  description:
    'Slide a hosted window or door along its wall: t is the normalized position of its center (0 = wall start, 0.25 = quarter, 0.5 = middle, 1 = wall end).',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const t = asNumber(raw['t'], 't');
      if (t < 0 || t > 1) {
        throw new ValidationError('t must be between 0 and 1');
      }
      return { id: asId(raw['id'], 'id'), t };
    },
    () =>
      S.object(
        {
          id: S.id('window or door entity id'),
          t: S.number('normalized position along the wall baseline, 0..1'),
        },
        ['id', 't'],
      ),
  ),
  execute(ctx, params) {
    const entity = ctx.doc.get(params.id);
    if (!(entity instanceof HostedOpeningEntity)) {
      throw new ValidationError(
        `entity ${params.id} is not a hosted opening (window or door)`,
      );
    }
    ctx.tx.update(entity, (opening) => {
      opening.t = params.t;
    });
  },
};

export function registerArchitectureCommands(registry: CommandRegistry): void {
  registry.register(AddWallCommand);
  registry.register(AddWindowCommand);
  registry.register(AddDoorCommand);
  registry.register(MoveOpeningCommand);
}
