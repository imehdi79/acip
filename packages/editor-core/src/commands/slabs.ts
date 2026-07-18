import type { EntityId, LayerId, LevelId, TypeId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { loopSignedArea } from '../topology/arrangement.js';
import { SlabEntity } from '../entities/architecture/slab-entity.js';
import { detectSpaces } from '../measurements/spaces.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asPoint, asPositive } from './validate.js';

export interface AddSlabParams {
  points: Point[];
  thickness?: number;
  typeId?: TypeId;
  levelId?: LevelId;
  layerId?: LayerId;
}

export const AddSlabCommand: Command<AddSlabParams, EntityId> = {
  name: 'SLAB.ADD',
  description:
    'Create a floor slab from a closed polygon footprint. The top face sits at the level ' +
    'elevation and extrudes down by the thickness (derived from the slab type assembly ' +
    'when typeId is given). Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      if (!Array.isArray(raw['points']) || raw['points'].length < 3) {
        throw new ValidationError(
          'points must be an array of at least 3 points',
        );
      }
      const params: AddSlabParams = {
        points: raw['points'].map((p, i) => asPoint(p, `points[${i}]`)),
      };
      if (raw['thickness'] !== undefined) {
        params.thickness = asPositive(raw['thickness'], 'thickness');
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
            'closed polygon footprint, in order',
          ),
          thickness: S.number(
            'slab thickness in meters (default 0.2; ignored when typeId has assembly layers)',
          ),
          typeId: S.id(
            'optional slab type id; thickness then derives from its assembly layers',
          ),
          levelId: S.id(
            'optional level (floor) id whose elevation is the slab top',
          ),
          layerId: S.id('optional layer id; defaults to the active layer'),
        },
        ['points'],
      ),
  ),
  execute(ctx, params) {
    if (Math.abs(loopSignedArea(params.points)) < 1e-9) {
      throw new ValidationError('slab footprint is degenerate (zero area)');
    }
    if (params.typeId !== undefined && !ctx.doc.types.has(params.typeId)) {
      throw new ValidationError(`type ${params.typeId} does not exist`);
    }
    const slab = new SlabEntity();
    slab.setFootprint(params.points);
    if (params.thickness !== undefined) slab.thickness = params.thickness;
    if (params.typeId !== undefined) slab.typeRef = params.typeId;
    if (params.levelId !== undefined) slab.baseLevelId = params.levelId;
    if (params.layerId !== undefined) slab.layerId = params.layerId;
    ctx.tx.create(slab);
    return slab.id;
  },
};

export interface AutoSlabParams {
  levelId?: LevelId;
  typeId?: TypeId;
}

/**
 * Floor every detected room on a level with one dispatch — the macro face
 * of space detection. Regenerates like DIM.AUTO: slabs it previously created
 * on the level are deleted and rebuilt from current rooms; hand-placed slabs
 * are never touched.
 */
export const AutoSlabCommand: Command<
  AutoSlabParams,
  { removed: number; created: number; totalArea: number }
> = {
  name: 'SLAB.AUTO',
  description:
    'Create a floor slab for every detected room on a level, using each room’s net ' +
    'boundary (inner wall faces). Re-running replaces previously auto-created slabs. ' +
    'Returns {removed, created, totalArea}.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AutoSlabParams = {};
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['typeId'] !== undefined) {
        params.typeId = asId(raw['typeId'], 'typeId') as string as TypeId;
      }
      return params;
    },
    () =>
      S.object({
        levelId: S.id('level to floor (omit for level-unassigned geometry)'),
        typeId: S.id('optional slab type applied to every created slab'),
      }),
  ),
  execute(ctx, params) {
    if (params.typeId !== undefined && !ctx.doc.types.has(params.typeId)) {
      throw new ValidationError(`type ${params.typeId} does not exist`);
    }
    const levelId = params.levelId ?? null;
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (
        entity instanceof SlabEntity &&
        entity.auto &&
        entity.baseLevelId === levelId
      ) {
        ctx.tx.remove(entity);
        removed += 1;
      }
    }
    let created = 0;
    let totalArea = 0;
    for (const space of detectSpaces(ctx.doc, levelId)) {
      const slab = new SlabEntity();
      slab.setFootprint(space.boundary);
      slab.auto = true;
      slab.baseLevelId = levelId;
      if (params.typeId !== undefined) slab.typeRef = params.typeId;
      ctx.tx.create(slab);
      created += 1;
      totalArea += slab.getArea();
    }
    return { removed, created, totalArea };
  },
};

export function registerSlabCommands(registry: CommandRegistry): void {
  registry.register(AddSlabCommand);
  registry.register(AutoSlabCommand);
}
