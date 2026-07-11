import type { EntityId, LayerId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { translation } from '../geometry/primitives/matrix3.js';
import { LineEntity } from '../entities/primitives/line-entity.js';
import { hasGrips } from '../entities/base/capabilities.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { asId, asIdArray, asNumber, asPoint } from './validate.js';

export interface AddLineParams {
  a: Point;
  b: Point;
  layerId?: LayerId;
}

export const AddLineCommand: Command<AddLineParams, EntityId> = {
  name: 'LINE.ADD',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    const result: AddLineParams = {
      a: asPoint(raw['a'], 'a'),
      b: asPoint(raw['b'], 'b'),
    };
    if (raw['layerId'] !== undefined) {
      if (typeof raw['layerId'] !== 'string') {
        throw new ValidationError('layerId must be a string');
      }
      result.layerId = raw['layerId'] as LayerId;
    }
    return result;
  }),
  execute(ctx, params) {
    const line = new LineEntity();
    line.setPoints(params.a, params.b);
    if (params.layerId) line.layerId = params.layerId;
    ctx.tx.create(line);
    return line.id;
  },
};

export interface MoveParams {
  ids: EntityId[];
  delta: Point;
}

export const MoveCommand: Command<MoveParams, number> = {
  name: 'ENTITY.MOVE',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      ids: asIdArray(raw['ids'], 'ids'),
      delta: asPoint(raw['delta'], 'delta'),
    };
  }),
  execute(ctx, params) {
    const m = translation(params.delta);
    let moved = 0;
    for (const id of params.ids) {
      const entity = ctx.doc.get(id);
      if (!entity) continue;
      entity.transform(m, ctx.tx);
      moved += 1;
    }
    return moved;
  },
};

export interface EraseParams {
  ids: EntityId[];
}

export const EraseCommand: Command<EraseParams, number> = {
  name: 'ENTITY.ERASE',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return { ids: asIdArray(raw['ids'], 'ids') };
  }),
  execute(ctx, params) {
    let erased = 0;
    const visit = (id: EntityId): void => {
      const entity = ctx.doc.get(id);
      if (!entity) return;
      // cascade: hosted entities go with their host (window dies with its wall)
      for (const hostedId of ctx.doc.relations.dependentsOf(id)) {
        visit(hostedId);
      }
      ctx.tx.remove(entity);
      erased += 1;
    };
    for (const id of params.ids) visit(id);
    return erased;
  },
};

export interface GripMoveParams {
  id: EntityId;
  index: number;
  to: Point;
}

export const GripMoveCommand: Command<GripMoveParams, void> = {
  name: 'GRIP.MOVE',
  params: paramsSchema((input) => {
    const raw = (input ?? {}) as Record<string, unknown>;
    return {
      id: asId(raw['id'], 'id'),
      index: asNumber(raw['index'], 'index'),
      to: asPoint(raw['to'], 'to'),
    };
  }),
  execute(ctx, params) {
    const entity = ctx.doc.get(params.id);
    if (!entity || !hasGrips(entity)) {
      throw new ValidationError(`entity ${params.id} has no grips`);
    }
    entity.moveGrip(params.index, params.to, ctx.tx);
  },
};

export function registerBuiltinCommands(registry: CommandRegistry): void {
  registry.register(AddLineCommand);
  registry.register(MoveCommand);
  registry.register(EraseCommand);
  registry.register(GripMoveCommand);
}
