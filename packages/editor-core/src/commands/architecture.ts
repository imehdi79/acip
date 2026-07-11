import type { EntityId, LevelId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { isHost } from '../entities/base/capabilities.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { WindowEntity } from '../entities/architecture/window-entity.js';
import { DoorEntity } from '../entities/architecture/door-entity.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { asId, asNumber, asPoint, asPositive } from './validate.js';

export interface AddWallParams {
  a: Point;
  b: Point;
  thickness?: number;
  height?: number;
  levelId?: LevelId;
}

export const AddWallCommand: Command<AddWallParams, EntityId> = {
  name: 'WALL.ADD',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const params: AddWallParams = {
      a: asPoint(raw['a'], 'a'),
      b: asPoint(raw['b'], 'b'),
    };
    if (raw['thickness'] !== undefined) params.thickness = asPositive(raw['thickness'], 'thickness');
    if (raw['height'] !== undefined) params.height = asPositive(raw['height'], 'height');
    if (raw['levelId'] !== undefined) params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
    return params;
  }),
  execute(ctx, params) {
    const wall = new WallEntity();
    wall.setBaseline(params.a, params.b);
    if (params.thickness !== undefined) wall.thickness = params.thickness;
    if (params.height !== undefined) wall.vertical = { height: params.height };
    if (params.levelId !== undefined) wall.baseLevelId = params.levelId;
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
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      wallId: asId(raw['wallId'], 'wallId'),
      t: asNumber(raw['t'], 't'),
      width: asPositive(raw['width'], 'width', 1.0),
      sill: asNumber(raw['sill'], 'sill', 0.9),
      height: asPositive(raw['height'], 'height', 1.2),
    };
  }),
  execute(ctx, params) {
    const host = ctx.doc.get(params.wallId);
    if (!host || !isHost(host)) {
      throw new ValidationError(`wallId ${params.wallId} does not reference a host entity`);
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
  params: paramsSchema((input) => {
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
  }),
  execute(ctx, params) {
    const host = ctx.doc.get(params.wallId);
    if (!host || !isHost(host)) {
      throw new ValidationError(`wallId ${params.wallId} does not reference a host entity`);
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

export function registerArchitectureCommands(registry: CommandRegistry): void {
  registry.register(AddWallCommand);
  registry.register(AddWindowCommand);
  registry.register(AddDoorCommand);
}
