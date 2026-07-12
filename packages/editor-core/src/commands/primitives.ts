import type { EntityId, LayerId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { CircleEntity } from '../entities/primitives/circle-entity.js';
import { ArcEntity } from '../entities/primitives/arc-entity.js';
import { PolylineEntity } from '../entities/primitives/polyline-entity.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asNumber, asPoint, asPositive } from './validate.js';

function optionalLayer(raw: Record<string, unknown>): LayerId | undefined {
  if (raw['layerId'] === undefined) return undefined;
  return asId(raw['layerId'], 'layerId') as string as LayerId;
}

export interface AddCircleParams {
  center: Point;
  radius: number;
  layerId?: LayerId;
}

export const AddCircleCommand: Command<AddCircleParams, EntityId> = {
  name: 'CIRCLE.ADD',
  description: 'Draw a circle from center and radius. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddCircleParams = {
        center: asPoint(raw['center'], 'center'),
        radius: asPositive(raw['radius'], 'radius'),
      };
      const layerId = optionalLayer(raw);
      if (layerId !== undefined) params.layerId = layerId;
      return params;
    },
    () =>
      S.object(
        {
          center: S.point('circle center'),
          radius: S.number('radius in meters (positive)'),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['center', 'radius'],
      ),
  ),
  execute(ctx, params) {
    const circle = new CircleEntity();
    circle.setCenter(params.center);
    circle.radius = params.radius;
    if (params.layerId) circle.layerId = params.layerId;
    ctx.tx.create(circle);
    return circle.id;
  },
};

export interface AddArcParams {
  center: Point;
  radius: number;
  startAngle: number;
  endAngle: number;
  layerId?: LayerId;
}

export const AddArcCommand: Command<AddArcParams, EntityId> = {
  name: 'ARC.ADD',
  description:
    'Draw a circular arc sweeping counter-clockwise from startAngle to endAngle (radians). Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddArcParams = {
        center: asPoint(raw['center'], 'center'),
        radius: asPositive(raw['radius'], 'radius'),
        startAngle: asNumber(raw['startAngle'], 'startAngle'),
        endAngle: asNumber(raw['endAngle'], 'endAngle'),
      };
      const layerId = optionalLayer(raw);
      if (layerId !== undefined) params.layerId = layerId;
      return params;
    },
    () =>
      S.object(
        {
          center: S.point('arc center'),
          radius: S.number('radius in meters (positive)'),
          startAngle: S.number('start angle in radians (0 = +x axis)'),
          endAngle: S.number('end angle in radians; sweep is counter-clockwise from start'),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['center', 'radius', 'startAngle', 'endAngle'],
      ),
  ),
  execute(ctx, params) {
    const arc = new ArcEntity();
    arc.setCenter(params.center);
    arc.radius = params.radius;
    arc.startAngle = params.startAngle;
    arc.endAngle = params.endAngle;
    if (params.layerId) arc.layerId = params.layerId;
    ctx.tx.create(arc);
    return arc.id;
  },
};

export interface AddPolylineParams {
  points: Point[];
  closed?: boolean;
  layerId?: LayerId;
}

export const AddPolylineCommand: Command<AddPolylineParams, EntityId> = {
  name: 'POLYLINE.ADD',
  description:
    'Draw a polyline through a sequence of points (at least 2); closed connects the last point back to the first. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      if (!Array.isArray(raw['points']) || raw['points'].length < 2) {
        throw new ValidationError('points must be an array of at least 2 points');
      }
      const params: AddPolylineParams = {
        points: raw['points'].map((p, i) => asPoint(p, `points[${i}]`)),
      };
      if (raw['closed'] !== undefined) {
        if (typeof raw['closed'] !== 'boolean') throw new ValidationError('closed must be boolean');
        params.closed = raw['closed'];
      }
      const layerId = optionalLayer(raw);
      if (layerId !== undefined) params.layerId = layerId;
      return params;
    },
    () =>
      S.object(
        {
          points: S.array(S.point('vertex'), 'polyline vertices in order (2 or more)'),
          closed: S.boolean('connect the last vertex back to the first (default false)'),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['points'],
      ),
  ),
  execute(ctx, params) {
    const polyline = new PolylineEntity();
    polyline.setPoints(params.points);
    polyline.closed = params.closed ?? false;
    if (params.layerId) polyline.layerId = params.layerId;
    ctx.tx.create(polyline);
    return polyline.id;
  },
};

export function registerPrimitiveCommands(registry: CommandRegistry): void {
  registry.register(AddCircleCommand);
  registry.register(AddArcCommand);
  registry.register(AddPolylineCommand);
}
