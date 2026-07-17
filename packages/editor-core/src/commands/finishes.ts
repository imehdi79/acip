import type { EntityId, LevelId, MaterialId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { SlabEntity } from '../entities/architecture/slab-entity.js';
import { FinishEntity } from '../entities/architecture/finish-entity.js';
import { detectSpaces } from '../measurements/spaces.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asNumber } from './validate.js';

type FaceSide = 'face+' | 'face-';

/** face+ → anchor 1, face- → anchor 2 in WallEntity.getAnchors() */
function anchorIndexForSide(side: FaceSide): number {
  return side === 'face+' ? 1 : 2;
}

function asSide(value: unknown, name: string): FaceSide {
  if (value === 'face+' || value === 'face-') return value;
  throw new ValidationError(`${name} must be 'face+' or 'face-'`);
}

export interface AddFinishParams {
  wallId: EntityId;
  side: FaceSide;
  materialId: MaterialId;
  sillHeight?: number;
  topHeight?: number;
  t0?: number;
  t1?: number;
  thickness?: number;
}

export const AddFinishCommand: Command<AddFinishParams, EntityId> = {
  name: 'FINISH.ADD',
  description:
    'Apply a surface finish (a material) to a wall face. The band spans [t0, t1] along ' +
    'the wall and [sillHeight, topHeight] vertically (topHeight omitted = full wall ' +
    'height); overlapping openings are subtracted from the finished area. The finish ' +
    'follows the wall and is priced by the material unit. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddFinishParams = {
        wallId: asId(raw['wallId'], 'wallId'),
        side: asSide(raw['side'], 'side'),
        materialId: asId(raw['materialId'], 'materialId') as string as MaterialId,
      };
      if (raw['sillHeight'] !== undefined) params.sillHeight = asNumber(raw['sillHeight'], 'sillHeight');
      if (raw['topHeight'] !== undefined) params.topHeight = asNumber(raw['topHeight'], 'topHeight');
      if (raw['t0'] !== undefined) params.t0 = asNumber(raw['t0'], 't0');
      if (raw['t1'] !== undefined) params.t1 = asNumber(raw['t1'], 't1');
      if (raw['thickness'] !== undefined) params.thickness = asNumber(raw['thickness'], 'thickness');
      return params;
    },
    () =>
      S.object(
        {
          wallId: S.id('id of the host wall'),
          side: S.enum(['face+', 'face-'], 'which wall face to finish'),
          materialId: S.id('material to apply (its unit drives pricing)'),
          sillHeight: S.number('band bottom above the wall base in meters (default 0)'),
          topHeight: S.number('band top in meters (default: full wall height)'),
          t0: S.number('band start along the wall, 0..1 (default 0)'),
          t1: S.number('band end along the wall, 0..1 (default 1)'),
          thickness: S.number('finish build-up thickness in meters (default 0.01; only m³ uses it)'),
        },
        ['wallId', 'side', 'materialId'],
      ),
  ),
  execute(ctx, params) {
    const wall = ctx.doc.get(params.wallId);
    if (!(wall instanceof WallEntity)) {
      throw new ValidationError(`wallId ${params.wallId} does not reference a wall`);
    }
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const finish = new FinishEntity();
    finish.materialId = params.materialId;
    if (params.sillHeight !== undefined) finish.sillHeight = params.sillHeight;
    if (params.topHeight !== undefined) finish.topHeight = params.topHeight;
    if (params.t0 !== undefined) finish.t0 = Math.min(1, Math.max(0, params.t0));
    if (params.t1 !== undefined) finish.t1 = Math.min(1, Math.max(0, params.t1));
    if (params.thickness !== undefined) finish.thickness = params.thickness;
    ctx.tx.create(finish);
    ctx.tx.attach(wall.id, finish.id, anchorIndexForSide(params.side), {});
    return finish.id;
  },
};

export interface AutoFinishParams {
  materialId: MaterialId;
  levelId?: LevelId;
  sillHeight?: number;
  topHeight?: number;
}

/**
 * Tile every wall of every detected room on a level with one dispatch, using
 * the room-facing face of each boundary wall (a shared wall is finished on
 * both sides — one finish per room). Regenerates like the other AUTO macros:
 * auto-created finishes on the level's walls are replaced; hand-placed
 * finishes are untouched.
 */
export const AutoFinishCommand: Command<
  AutoFinishParams,
  { removed: number; created: number; totalArea: number }
> = {
  name: 'FINISH.AUTO',
  description:
    'Finish every room on a level: apply a material to the room-facing face of each ' +
    'boundary wall. Re-running replaces previously auto-created finishes. ' +
    'Returns {removed, created, totalArea}.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AutoFinishParams = {
        materialId: asId(raw['materialId'], 'materialId') as string as MaterialId,
      };
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['sillHeight'] !== undefined) params.sillHeight = asNumber(raw['sillHeight'], 'sillHeight');
      if (raw['topHeight'] !== undefined) params.topHeight = asNumber(raw['topHeight'], 'topHeight');
      return params;
    },
    () =>
      S.object(
        {
          materialId: S.id('material to apply to every room-facing wall face'),
          levelId: S.id('level to finish (omit for level-unassigned geometry)'),
          sillHeight: S.number('band bottom above the wall base (default 0)'),
          topHeight: S.number('band top in meters (default: full wall height)'),
        },
        ['materialId'],
      ),
  ),
  execute(ctx, params) {
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const levelId = params.levelId ?? null;
    const onLevel = (wall: WallEntity): boolean =>
      levelId === null || wall.baseLevelId === null || wall.baseLevelId === levelId;

    // remove prior auto finishes whose host wall is on this level
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (!(entity instanceof FinishEntity) || !entity.auto) continue;
      const relation = ctx.doc.relations.relationOfHosted(entity.id);
      const host = relation ? ctx.doc.get(relation.hostId) : null;
      if (host instanceof WallEntity && onLevel(host)) {
        ctx.tx.remove(entity);
        removed += 1;
      }
    }

    let created = 0;
    let totalArea = 0;
    for (const space of detectSpaces(ctx.doc, levelId)) {
      for (const bf of space.boundaryFaces) {
        const wall = ctx.doc.get(bf.wallId);
        if (!(wall instanceof WallEntity)) continue;
        const finish = new FinishEntity();
        finish.materialId = params.materialId;
        finish.auto = true;
        if (params.sillHeight !== undefined) finish.sillHeight = params.sillHeight;
        if (params.topHeight !== undefined) finish.topHeight = params.topHeight;
        ctx.tx.create(finish);
        ctx.tx.attach(wall.id, finish.id, anchorIndexForSide(bf.side), {});
        created += 1;
        totalArea += finish.getNetArea();
      }
    }
    return { removed, created, totalArea };
  },
};

type SlabSurface = 'top' | 'bottom';

/** top (floor finish) → anchor 0, bottom (ceiling) → anchor 1 */
function anchorIndexForSurface(surface: SlabSurface): number {
  return surface === 'bottom' ? 1 : 0;
}

function asSurface(value: unknown): SlabSurface {
  if (value === undefined || value === 'top') return 'top';
  if (value === 'bottom') return 'bottom';
  throw new ValidationError("surface must be 'top' or 'bottom'");
}

export interface AddFloorFinishParams {
  slabId: EntityId;
  materialId: MaterialId;
  surface?: SlabSurface;
  thickness?: number;
}

export const AddFloorFinishCommand: Command<AddFloorFinishParams, EntityId> = {
  name: 'FLOORFINISH.ADD',
  description:
    'Apply a floor (top) or ceiling (bottom) finish to a slab, covering its whole ' +
    'footprint. The finish follows the slab and is priced by the material unit. ' +
    'Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddFloorFinishParams = {
        slabId: asId(raw['slabId'], 'slabId'),
        materialId: asId(raw['materialId'], 'materialId') as string as MaterialId,
        surface: asSurface(raw['surface']),
      };
      if (raw['thickness'] !== undefined) params.thickness = asNumber(raw['thickness'], 'thickness');
      return params;
    },
    () =>
      S.object(
        {
          slabId: S.id('id of the host slab'),
          materialId: S.id('material to apply (its unit drives pricing)'),
          surface: S.enum(['top', 'bottom'], 'top = floor finish, bottom = ceiling (default top)'),
          thickness: S.number('finish build-up thickness in meters (default 0.01; only m³ uses it)'),
        },
        ['slabId', 'materialId'],
      ),
  ),
  execute(ctx, params) {
    const slab = ctx.doc.get(params.slabId);
    if (!(slab instanceof SlabEntity)) {
      throw new ValidationError(`slabId ${params.slabId} does not reference a slab`);
    }
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const finish = new FinishEntity();
    finish.materialId = params.materialId;
    if (params.thickness !== undefined) finish.thickness = params.thickness;
    ctx.tx.create(finish);
    ctx.tx.attach(slab.id, finish.id, anchorIndexForSurface(params.surface ?? 'top'), {});
    return finish.id;
  },
};

export interface AutoFloorFinishParams {
  materialId: MaterialId;
  levelId?: LevelId;
  surface?: SlabSurface;
}

/**
 * Floor-finish every slab on a level with one dispatch (run SLAB.AUTO first
 * to get a slab per room). Regenerates like the other AUTO macros: auto slab
 * finishes on the level are replaced; hand-placed and wall finishes untouched.
 */
export const AutoFloorFinishCommand: Command<
  AutoFloorFinishParams,
  { removed: number; created: number; totalArea: number }
> = {
  name: 'FLOORFINISH.AUTO',
  description:
    'Apply a floor (or ceiling) finish to every slab on a level, covering each footprint. ' +
    'Re-running replaces previously auto-created floor finishes. Returns {removed, created, totalArea}.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AutoFloorFinishParams = {
        materialId: asId(raw['materialId'], 'materialId') as string as MaterialId,
        surface: asSurface(raw['surface']),
      };
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      return params;
    },
    () =>
      S.object(
        {
          materialId: S.id('material to apply to every slab'),
          levelId: S.id('level to finish (omit for level-unassigned geometry)'),
          surface: S.enum(['top', 'bottom'], 'top = floor, bottom = ceiling (default top)'),
        },
        ['materialId'],
      ),
  ),
  execute(ctx, params) {
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const levelId = params.levelId ?? null;
    const anchorIdx = anchorIndexForSurface(params.surface ?? 'top');
    const onLevel = (slab: SlabEntity): boolean =>
      levelId === null || slab.baseLevelId === null || slab.baseLevelId === levelId;

    // remove prior auto finishes whose host slab is on this level (and matches
    // the surface), leaving wall finishes and the other surface untouched
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (!(entity instanceof FinishEntity) || !entity.auto) continue;
      const relation = ctx.doc.relations.relationOfHosted(entity.id);
      const host = relation ? ctx.doc.get(relation.hostId) : null;
      if (host instanceof SlabEntity && onLevel(host) && relation!.anchorIndex === anchorIdx) {
        ctx.tx.remove(entity);
        removed += 1;
      }
    }

    let created = 0;
    let totalArea = 0;
    for (const slab of ctx.doc.all()) {
      if (!(slab instanceof SlabEntity) || !onLevel(slab)) continue;
      const finish = new FinishEntity();
      finish.materialId = params.materialId;
      finish.auto = true;
      ctx.tx.create(finish);
      ctx.tx.attach(slab.id, finish.id, anchorIdx, {});
      created += 1;
      totalArea += finish.getNetArea();
    }
    return { removed, created, totalArea };
  },
};

export function registerFinishCommands(registry: CommandRegistry): void {
  registry.register(AddFinishCommand);
  registry.register(AutoFinishCommand);
  registry.register(AddFloorFinishCommand);
  registry.register(AutoFloorFinishCommand);
}
