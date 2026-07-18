import type { EntityId, LayerId, LevelId, TypeId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { bboxFromPoints } from '../geometry/primitives/bbox.js';
import { loopSignedArea } from '../topology/arrangement.js';
import { RoofEntity } from '../entities/architecture/roof-entity.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { detectOutlines, offsetBoundary } from '../measurements/spaces.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asNumber, asPoint, asPositive } from './validate.js';

const DEFAULT_SLOPE = 15;
const DEFAULT_OVERHANG = 0.3;

function asSlope(value: unknown): number {
  const slope = asNumber(value, 'slope');
  if (slope < 0 || slope > 85)
    throw new ValidationError('slope must be within 0..85 degrees');
  return slope;
}

export interface AddRoofParams {
  points: Point[];
  slope?: number;
  direction?: Point;
  thickness?: number;
  eavesHeight?: number;
  typeId?: TypeId;
  levelId?: LevelId;
  layerId?: LayerId;
}

export const AddRoofCommand: Command<AddRoofParams, EntityId> = {
  name: 'ROOF.ADD',
  description:
    'Create a mono-pitch roof from a closed footprint. Eaves sit at the level elevation ' +
    'plus eavesHeight at the most-downhill vertex, rising at the slope (degrees) against ' +
    'the fall direction. Thickness derives from the roof type assembly when typeId is ' +
    'given. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      if (!Array.isArray(raw['points']) || raw['points'].length < 3) {
        throw new ValidationError(
          'points must be an array of at least 3 points',
        );
      }
      const params: AddRoofParams = {
        points: raw['points'].map((p, i) => asPoint(p, `points[${i}]`)),
      };
      if (raw['slope'] !== undefined) params.slope = asSlope(raw['slope']);
      if (raw['direction'] !== undefined)
        params.direction = asPoint(raw['direction'], 'direction');
      if (raw['thickness'] !== undefined) {
        params.thickness = asPositive(raw['thickness'], 'thickness');
      }
      if (raw['eavesHeight'] !== undefined) {
        params.eavesHeight = asNumber(raw['eavesHeight'], 'eavesHeight');
      }
      if (raw['typeId'] !== undefined) {
        params.typeId = asId(raw['typeId'], 'typeId') as string as TypeId;
      }
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['layerId'] !== undefined) {
        params.layerId = asId(raw['layerId'], 'layerId') as string as LayerId;
      }
      return params;
    },
    () =>
      S.object(
        {
          points: S.array(
            S.point('footprint vertex'),
            'closed roof footprint, in order',
          ),
          slope: S.number('pitch in degrees, 0 = flat (default 15)'),
          direction: S.point(
            'downhill fall direction in plan (default {x:0,y:-1})',
          ),
          thickness: S.number(
            'roof thickness in meters, measured vertically (default 0.25; ignored when typeId has assembly layers)',
          ),
          eavesHeight: S.number(
            'eaves height above the level elevation (default 3)',
          ),
          typeId: S.id(
            'optional roof type id; thickness then derives from its assembly layers',
          ),
          levelId: S.id('optional level (floor) id the roof covers'),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['points'],
      ),
  ),
  execute(ctx, params) {
    if (Math.abs(loopSignedArea(params.points)) < 1e-9) {
      throw new ValidationError('roof footprint is degenerate (zero area)');
    }
    if (params.typeId !== undefined && !ctx.doc.types.has(params.typeId)) {
      throw new ValidationError(`type ${params.typeId} does not exist`);
    }
    const roof = new RoofEntity();
    roof.setFootprint(params.points);
    if (params.slope !== undefined) roof.slope = params.slope;
    if (params.direction !== undefined) roof.direction = params.direction;
    if (params.thickness !== undefined) roof.thickness = params.thickness;
    if (params.eavesHeight !== undefined) roof.eavesHeight = params.eavesHeight;
    if (params.typeId !== undefined) roof.typeRef = params.typeId;
    if (params.levelId !== undefined) roof.baseLevelId = params.levelId;
    if (params.layerId !== undefined) roof.layerId = params.layerId;
    ctx.tx.create(roof);
    return roof.id;
  },
};

export interface AutoRoofParams {
  levelId?: LevelId;
  slope?: number;
  overhang?: number;
  typeId?: TypeId;
}

/**
 * Roof the whole building in one dispatch: footprint = the arrangement's
 * outer contour pushed out to the wall faces plus an overhang, eaves at the
 * tallest wall's top, fall across the footprint's narrow axis. Regenerates
 * like DIM.AUTO/SLAB.AUTO; hand-placed roofs are never touched. Detached
 * buildings each get their own roof.
 */
export const AutoRoofCommand: Command<
  AutoRoofParams,
  { removed: number; created: number; planArea: number }
> = {
  name: 'ROOF.AUTO',
  description:
    'Put a mono-pitch roof over every building outline on a level: footprint from the ' +
    'outer wall faces plus an overhang, eaves on the tallest wall, fall across the ' +
    'narrow axis. Re-running replaces previously auto-created roofs. ' +
    'Returns {removed, created, planArea}.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AutoRoofParams = {};
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['slope'] !== undefined) params.slope = asSlope(raw['slope']);
      if (raw['overhang'] !== undefined) {
        params.overhang = asNumber(raw['overhang'], 'overhang');
        if (params.overhang < 0)
          throw new ValidationError('overhang must be ≥ 0');
      }
      if (raw['typeId'] !== undefined) {
        params.typeId = asId(raw['typeId'], 'typeId') as string as TypeId;
      }
      return params;
    },
    () =>
      S.object({
        levelId: S.id('level to roof (omit for level-unassigned geometry)'),
        slope: S.number('pitch in degrees (default 15)'),
        overhang: S.number(
          'eaves overhang beyond the outer wall faces in meters (default 0.3)',
        ),
        typeId: S.id('optional roof type applied to every created roof'),
      }),
  ),
  execute(ctx, params) {
    if (params.typeId !== undefined && !ctx.doc.types.has(params.typeId)) {
      throw new ValidationError(`type ${params.typeId} does not exist`);
    }
    const levelId = params.levelId ?? null;
    const overhang = params.overhang ?? DEFAULT_OVERHANG;
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (
        entity instanceof RoofEntity &&
        entity.auto &&
        entity.baseLevelId === levelId
      ) {
        ctx.tx.remove(entity);
        removed += 1;
      }
    }
    let created = 0;
    let planArea = 0;
    for (const outline of detectOutlines(ctx.doc, levelId)) {
      const halfWidthOf = (id: string): number => {
        const wall = ctx.doc.get(id as EntityId);
        return wall instanceof WallEntity ? wall.getThickness() / 2 : 0;
      };
      const footprint = offsetBoundary(
        outline.edges,
        (id) => -(halfWidthOf(id) + overhang),
      );
      if (Math.abs(loopSignedArea(footprint)) < 1e-9) continue;

      const roof = new RoofEntity();
      roof.setFootprint(footprint);
      roof.slope = params.slope ?? DEFAULT_SLOPE;
      // sheds fall across the narrow span
      const bounds = bboxFromPoints(footprint);
      roof.direction =
        bounds.maxX - bounds.minX >= bounds.maxY - bounds.minY
          ? { x: 0, y: -1 }
          : { x: -1, y: 0 };
      // eaves land on the tallest wall of this outline
      let eaves = 0;
      for (const wallId of outline.boundaryWallIds) {
        const wall = ctx.doc.get(wallId);
        if (wall instanceof WallEntity)
          eaves = Math.max(eaves, wall.getHeight());
      }
      roof.eavesHeight = eaves > 0 ? eaves : roof.eavesHeight;
      roof.auto = true;
      roof.baseLevelId = levelId;
      if (params.typeId !== undefined) roof.typeRef = params.typeId;
      ctx.tx.create(roof);
      created += 1;
      planArea += roof.getPlanArea();
    }
    return { removed, created, planArea };
  },
};

export function registerRoofCommands(registry: CommandRegistry): void {
  registry.register(AddRoofCommand);
  registry.register(AutoRoofCommand);
}
