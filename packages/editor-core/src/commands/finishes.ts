import type { EntityId, LevelId, MaterialId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { SlabEntity } from '../entities/architecture/slab-entity.js';
import { FinishEntity } from '../entities/architecture/finish-entity.js';
import type { Phase } from '../entities/architecture/phase.js';
import { PHASES, isPhase } from '../entities/architecture/phase.js';
import { detectSpaces } from '../measurements/spaces.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asNumber, asPositive } from './validate.js';

type FaceSide = 'face+' | 'face-';

/** validate an optional phase param (throws on a bad value; undefined = unset) */
function asPhaseParam(value: unknown): Phase | undefined {
  if (value === undefined) return undefined;
  if (!isPhase(value)) {
    throw new ValidationError(`phase must be one of ${PHASES.join(', ')}`);
  }
  return value;
}

/** shared schema field so every finish command documents phase identically */
const phaseField = S.enum(
  PHASES,
  "'new' = build/install (default); 'demolish' = strip existing, priced to remove",
);

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
  phase?: Phase;
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
        materialId: asId(
          raw['materialId'],
          'materialId',
        ) as string as MaterialId,
      };
      if (raw['sillHeight'] !== undefined)
        params.sillHeight = asNumber(raw['sillHeight'], 'sillHeight');
      if (raw['topHeight'] !== undefined)
        params.topHeight = asNumber(raw['topHeight'], 'topHeight');
      if (raw['t0'] !== undefined) params.t0 = asNumber(raw['t0'], 't0');
      if (raw['t1'] !== undefined) params.t1 = asNumber(raw['t1'], 't1');
      if (raw['thickness'] !== undefined)
        params.thickness = asNumber(raw['thickness'], 'thickness');
      const phase = asPhaseParam(raw['phase']);
      if (phase !== undefined) params.phase = phase;
      return params;
    },
    () =>
      S.object(
        {
          wallId: S.id('id of the host wall'),
          side: S.enum(['face+', 'face-'], 'which wall face to finish'),
          materialId: S.id('material to apply (its unit drives pricing)'),
          sillHeight: S.number(
            'band bottom above the wall base in meters (default 0)',
          ),
          topHeight: S.number('band top in meters (default: full wall height)'),
          t0: S.number('band start along the wall, 0..1 (default 0)'),
          t1: S.number('band end along the wall, 0..1 (default 1)'),
          thickness: S.number(
            'finish build-up thickness in meters (default 0.01; only m³ uses it)',
          ),
          phase: phaseField,
        },
        ['wallId', 'side', 'materialId'],
      ),
  ),
  execute(ctx, params) {
    const wall = ctx.doc.get(params.wallId);
    if (!(wall instanceof WallEntity)) {
      throw new ValidationError(
        `wallId ${params.wallId} does not reference a wall`,
      );
    }
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const finish = new FinishEntity();
    finish.materialId = params.materialId;
    if (params.sillHeight !== undefined) finish.sillHeight = params.sillHeight;
    if (params.topHeight !== undefined) finish.topHeight = params.topHeight;
    if (params.t0 !== undefined)
      finish.t0 = Math.min(1, Math.max(0, params.t0));
    if (params.t1 !== undefined)
      finish.t1 = Math.min(1, Math.max(0, params.t1));
    if (params.thickness !== undefined) finish.thickness = params.thickness;
    if (params.phase !== undefined) finish.phase = params.phase;
    ctx.tx.create(finish);
    ctx.tx.attach(wall.id, finish.id, anchorIndexForSide(params.side), {});
    return finish.id;
  },
};

/**
 * An along-wall baseline parameter. FINISH.ADD clamps a stray value into
 * range; an update rejects it, because there the number is an edit of one the
 * caller can already see — silently moving t1 from 1.4 to 1 would report
 * success for a band the caller never asked for.
 */
function asBaselineParam(value: unknown, label: string): number {
  const t = asNumber(value, label);
  if (t < 0 || t > 1) {
    throw new ValidationError(`${label} (${t}) must be between 0 and 1`);
  }
  return t;
}

export interface UpdateFinishParams {
  id: EntityId;
  materialId?: MaterialId;
  sillHeight?: number;
  topHeight?: number;
  fullHeight?: boolean;
  t0?: number;
  t1?: number;
  thickness?: number;
  deductOpenings?: boolean;
  coverWidth?: number;
  coverHeight?: number;
  /** clears coverWidth/coverHeight — back to the whole slab footprint */
  wholeSlab?: boolean;
}

/**
 * Edit a finish in place — the band, the extent, the material. Until this
 * existed the only way to turn "tile to 1.2 m" into "tile to 1.5 m" was to
 * erase the finish and re-add it, which mints a NEW entity id and drops the
 * finish to the bottom of its host's stack every time: the selection is lost,
 * the mark jumps, and anything holding the old id (a BOQ line already shown to
 * the user, an agent's own notes) points at nothing — all for what reads as
 * dragging one number. Updating keeps the identity and moves only the values;
 * area, quantity and price re-derive on the next read exactly as they do when
 * the host wall is stretched.
 *
 * Only the fields passed change. That one rule forces the decisions below.
 *
 * `topHeight` is `number | null` on the entity, where null means "run to the
 * top of the wall, and keep doing so as the wall grows". Omission cannot say
 * that — omission already means "unchanged" — and the schema vocabulary these
 * commands publish as LLM tool definitions has no nullable number, so typing
 * the field `number` while asking in prose for a `null` would be a schema that
 * lies about what it accepts. The null state therefore gets its own boolean:
 * `fullHeight: true` clears `topHeight`. Sending both is a contradiction and
 * is rejected rather than silently ordered.
 *
 * `phase` is deliberately absent although it is a finish field: PHASE.SET
 * already moves finishes and openings between build and demolish, in bulk and
 * across entity kinds. Duplicating it here would leave one field with two
 * writers to keep in step, and an agent offered two ways to do one thing picks
 * the wrong one often enough to matter.
 *
 * A slab-hosted finish (a floor, a ceiling) is its host's whole footprint;
 * FinishEntity never reads the band or the extent for one. Passing them is
 * REJECTED rather than ignored, because the caller has stated an intent the
 * model cannot honour, and a silent success teaches an agent that its 1.2 m
 * dado on the kitchen floor worked. `materialId` and `thickness` do apply to a
 * slab finish (thickness is the screed depth an m³ material bills on), so the
 * command stays useful there — it refuses exactly the fields FLOORFINISH.ADD
 * never offered in the first place.
 */
export const UpdateFinishCommand: Command<UpdateFinishParams, void> = {
  name: 'FINISH.UPDATE',
  description:
    'Edit an existing finish in place: its material, its vertical band ' +
    '[sillHeight, topHeight] and its extent along the wall [t0, t1]. Only the fields ' +
    'you pass change; the rest keep their current values, and the entity keeps its id ' +
    'and its place in the stack. Pass fullHeight:true (instead of topHeight) to send ' +
    'the band back up to the full wall height. The build/demolish phase is set by ' +
    'PHASE.SET, not here. Band and extent do not exist for a slab-hosted floor or ' +
    'ceiling finish and are rejected for one.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: UpdateFinishParams = { id: asId(raw['id'], 'id') };
      if (raw['materialId'] !== undefined) {
        params.materialId = asId(
          raw['materialId'],
          'materialId',
        ) as string as MaterialId;
      }
      if (raw['sillHeight'] !== undefined) {
        const sillHeight = asNumber(raw['sillHeight'], 'sillHeight');
        if (sillHeight < 0) {
          throw new ValidationError(
            `sillHeight (${sillHeight}) must be 0 or greater`,
          );
        }
        params.sillHeight = sillHeight;
      }
      if (raw['topHeight'] !== undefined)
        params.topHeight = asNumber(raw['topHeight'], 'topHeight');
      if (raw['fullHeight'] !== undefined) {
        if (typeof raw['fullHeight'] !== 'boolean') {
          throw new ValidationError('fullHeight must be boolean');
        }
        // `fullHeight: false` is not the opposite of anything — the opposite of
        // a full-height band is one with a top, and that top is `topHeight` —
        // so it parses away to "no change" rather than to a second way of
        // spelling a number
        if (raw['fullHeight']) params.fullHeight = true;
      }
      if (params.fullHeight && params.topHeight !== undefined) {
        throw new ValidationError(
          'pass topHeight or fullHeight, not both — fullHeight clears topHeight',
        );
      }
      if (raw['t0'] !== undefined) params.t0 = asBaselineParam(raw['t0'], 't0');
      if (raw['t1'] !== undefined) params.t1 = asBaselineParam(raw['t1'], 't1');
      if (raw['thickness'] !== undefined)
        params.thickness = asPositive(raw['thickness'], 'thickness');
      if (raw['deductOpenings'] !== undefined) {
        if (typeof raw['deductOpenings'] !== 'boolean') {
          throw new ValidationError('deductOpenings must be boolean');
        }
        params.deductOpenings = raw['deductOpenings'];
      }
      if (raw['coverWidth'] !== undefined)
        params.coverWidth = asPositive(raw['coverWidth'], 'coverWidth');
      if (raw['coverHeight'] !== undefined)
        params.coverHeight = asPositive(raw['coverHeight'], 'coverHeight');
      if (raw['wholeSlab'] !== undefined) {
        if (typeof raw['wholeSlab'] !== 'boolean') {
          throw new ValidationError('wholeSlab must be boolean');
        }
        // like `fullHeight: false`, `wholeSlab: false` is not the opposite of
        // anything — the opposite of the whole slab is a rectangle, and that
        // is coverWidth/coverHeight
        if (raw['wholeSlab']) params.wholeSlab = true;
      }
      if (
        params.wholeSlab &&
        (params.coverWidth !== undefined || params.coverHeight !== undefined)
      ) {
        throw new ValidationError(
          'pass coverWidth/coverHeight or wholeSlab, not both — wholeSlab clears them',
        );
      }
      if (
        params.materialId === undefined &&
        params.sillHeight === undefined &&
        params.topHeight === undefined &&
        params.fullHeight === undefined &&
        params.t0 === undefined &&
        params.t1 === undefined &&
        params.thickness === undefined &&
        params.deductOpenings === undefined &&
        params.coverWidth === undefined &&
        params.coverHeight === undefined &&
        params.wholeSlab === undefined
      ) {
        throw new ValidationError(
          'provide materialId, sillHeight, topHeight, fullHeight, t0, t1, thickness, ' +
            'deductOpenings, coverWidth, coverHeight, and/or wholeSlab',
        );
      }
      return params;
    },
    () =>
      S.object(
        {
          id: S.id('id of the finish to edit'),
          materialId: S.id('replacement material (its unit drives pricing)'),
          sillHeight: S.number(
            'new band bottom above the wall base in meters, 0 or greater',
          ),
          topHeight: S.number(
            'new band top in meters, above sillHeight; use fullHeight to clear it',
          ),
          fullHeight: S.boolean(
            'true = clear topHeight so the band runs to the top of the wall and ' +
              'follows it; the only way to undo a topHeight, and not combinable with one',
          ),
          t0: S.number('new band start along the wall, 0..1, below t1'),
          t1: S.number('new band end along the wall, 0..1, above t0'),
          thickness: S.number(
            'new build-up thickness in meters, greater than 0 (only m³ uses it)',
          ),
          deductOpenings: S.boolean(
            'true (default) = measured net, openings come out of the area; ' +
              'false = measured solid, the face is priced over its full extent and ' +
              'the doors and windows in it are billed as their own items. Wall faces only.',
          ),
          coverWidth: S.number(
            'width in meters of the rectangle a FLOOR or CEILING finish covers; ' +
              'pair with coverHeight, or use wholeSlab to cover the whole footprint',
          ),
          coverHeight: S.number(
            'height in meters of that rectangle, measured on the plan',
          ),
          wholeSlab: S.boolean(
            'true = clear coverWidth/coverHeight so the finish covers the whole slab ' +
              'again; the only way to undo a covered rectangle, and not combinable with one',
          ),
        },
        ['id'],
      ),
  ),
  execute(ctx, params) {
    const finish = ctx.doc.get(params.id);
    if (!(finish instanceof FinishEntity)) {
      throw new ValidationError(`id ${params.id} does not reference a finish`);
    }
    if (
      params.materialId !== undefined &&
      !ctx.doc.materials.has(params.materialId)
    ) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }

    // the band and the extent describe a wall face; on a slab the finish IS the
    // footprint and never reads them, so refuse the fields instead of no-opping
    // them and reporting a dado on the floor as done
    const relation = ctx.doc.relations.relationOfHosted(finish.id);
    const host = relation ? ctx.doc.get(relation.hostId) : null;
    const bandGiven =
      params.sillHeight !== undefined ||
      params.topHeight !== undefined ||
      params.fullHeight !== undefined ||
      params.t0 !== undefined ||
      params.t1 !== undefined;
    if (host instanceof SlabEntity && bandGiven) {
      throw new ValidationError(
        `finish ${params.id} is hosted on a slab: sillHeight, topHeight, ` +
          'fullHeight, t0 and t1 describe a wall band and do not apply to a ' +
          'floor or ceiling finish — use coverWidth/coverHeight',
      );
    }

    // The mirror image, and refused for the mirror reason. A wall band is
    // already a width and a height, anchored to the wall so it follows it; a
    // covered rectangle is an unanchored takeoff figure. Accepting both on one
    // finish would be two ways to say its extent, with nothing to decide which
    // one the area came from.
    const coverGiven =
      params.coverWidth !== undefined ||
      params.coverHeight !== undefined ||
      params.wholeSlab !== undefined;
    if (host instanceof WallEntity && coverGiven) {
      throw new ValidationError(
        `finish ${params.id} is hosted on a wall face: coverWidth, ` +
          'coverHeight and wholeSlab describe a floor or ceiling area — a ' +
          'wall band is set with sillHeight, topHeight, t0 and t1',
      );
    }
    // only a wall face has openings to argue about; on a slab the flag would
    // be a setting the caller could never see the effect of
    if (host instanceof SlabEntity && params.deductOpenings !== undefined) {
      throw new ValidationError(
        `finish ${params.id} is hosted on a slab: deductOpenings applies to ` +
          'the openings crossing a wall band, and a slab has none',
      );
    }

    // Both halves of the rectangle or neither: one alone cannot say what area
    // is covered, and defaulting the missing one would invent a dimension the
    // user did not measure.
    const coverWidth = params.wholeSlab
      ? null
      : (params.coverWidth ?? finish.coverWidth);
    const coverHeight = params.wholeSlab
      ? null
      : (params.coverHeight ?? finish.coverHeight);
    if ((coverWidth === null) !== (coverHeight === null)) {
      throw new ValidationError(
        'coverWidth and coverHeight go together — pass both to cover a ' +
          'rectangle, or wholeSlab to cover the whole footprint',
      );
    }

    // Cross-field rules are checked against the MERGED band, never against the
    // params alone: in a partial update the other half of a pair is whatever is
    // already on the entity, so raising sillHeight past a topHeight set an hour
    // ago has to fail exactly as passing the two together would. Merging first
    // also means the write below is a plain assignment — an omitted field
    // resolves to its own current value, so "unchanged" needs no special case.
    const t0 = params.t0 ?? finish.t0;
    const t1 = params.t1 ?? finish.t1;
    if (t0 >= t1) {
      throw new ValidationError(`t0 (${t0}) must be less than t1 (${t1})`);
    }
    const sillHeight = params.sillHeight ?? finish.sillHeight;
    const topHeight = params.fullHeight
      ? null
      : (params.topHeight ?? finish.topHeight);
    if (topHeight !== null && topHeight <= sillHeight) {
      throw new ValidationError(
        `topHeight (${topHeight}) must be above sillHeight (${sillHeight})`,
      );
    }

    // through the transaction: the snapshot it takes here is what undo replays,
    // and the change it records is what marks quantities and the estimator dirty
    ctx.tx.update(finish, (f) => {
      if (params.materialId !== undefined) f.materialId = params.materialId;
      if (params.thickness !== undefined) f.thickness = params.thickness;
      if (params.deductOpenings !== undefined)
        f.deductOpenings = params.deductOpenings;
      f.sillHeight = sillHeight;
      f.topHeight = topHeight;
      f.t0 = t0;
      f.t1 = t1;
      f.coverWidth = coverWidth;
      f.coverHeight = coverHeight;
    });
  },
};

export interface AutoFinishParams {
  materialId: MaterialId;
  levelId?: LevelId;
  sillHeight?: number;
  topHeight?: number;
  phase?: Phase;
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
        materialId: asId(
          raw['materialId'],
          'materialId',
        ) as string as MaterialId,
      };
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['sillHeight'] !== undefined)
        params.sillHeight = asNumber(raw['sillHeight'], 'sillHeight');
      if (raw['topHeight'] !== undefined)
        params.topHeight = asNumber(raw['topHeight'], 'topHeight');
      const phase = asPhaseParam(raw['phase']);
      if (phase !== undefined) params.phase = phase;
      return params;
    },
    () =>
      S.object(
        {
          materialId: S.id('material to apply to every room-facing wall face'),
          levelId: S.id('level to finish (omit for level-unassigned geometry)'),
          sillHeight: S.number('band bottom above the wall base (default 0)'),
          topHeight: S.number('band top in meters (default: full wall height)'),
          phase: phaseField,
        },
        ['materialId'],
      ),
  ),
  execute(ctx, params) {
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const levelId = params.levelId ?? null;
    const phase: Phase = params.phase ?? 'new';
    const onLevel = (wall: WallEntity): boolean =>
      levelId === null ||
      wall.baseLevelId === null ||
      wall.baseLevelId === levelId;

    // remove prior auto finishes of THIS phase whose host wall is on this
    // level — a demolish pass and a new pass regenerate independently
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (!(entity instanceof FinishEntity) || !entity.auto) continue;
      if (entity.phase !== phase) continue;
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
        finish.phase = phase;
        if (params.sillHeight !== undefined)
          finish.sillHeight = params.sillHeight;
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
  phase?: Phase;
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
        materialId: asId(
          raw['materialId'],
          'materialId',
        ) as string as MaterialId,
        surface: asSurface(raw['surface']),
      };
      if (raw['thickness'] !== undefined)
        params.thickness = asNumber(raw['thickness'], 'thickness');
      const phase = asPhaseParam(raw['phase']);
      if (phase !== undefined) params.phase = phase;
      return params;
    },
    () =>
      S.object(
        {
          slabId: S.id('id of the host slab'),
          materialId: S.id('material to apply (its unit drives pricing)'),
          surface: S.enum(
            ['top', 'bottom'],
            'top = floor finish, bottom = ceiling (default top)',
          ),
          thickness: S.number(
            'finish build-up thickness in meters (default 0.01; only m³ uses it)',
          ),
          phase: phaseField,
        },
        ['slabId', 'materialId'],
      ),
  ),
  execute(ctx, params) {
    const slab = ctx.doc.get(params.slabId);
    if (!(slab instanceof SlabEntity)) {
      throw new ValidationError(
        `slabId ${params.slabId} does not reference a slab`,
      );
    }
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const finish = new FinishEntity();
    finish.materialId = params.materialId;
    if (params.thickness !== undefined) finish.thickness = params.thickness;
    if (params.phase !== undefined) finish.phase = params.phase;
    ctx.tx.create(finish);
    ctx.tx.attach(
      slab.id,
      finish.id,
      anchorIndexForSurface(params.surface ?? 'top'),
      {},
    );
    return finish.id;
  },
};

export interface AutoFloorFinishParams {
  materialId: MaterialId;
  levelId?: LevelId;
  surface?: SlabSurface;
  phase?: Phase;
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
        materialId: asId(
          raw['materialId'],
          'materialId',
        ) as string as MaterialId,
        surface: asSurface(raw['surface']),
      };
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      const phase = asPhaseParam(raw['phase']);
      if (phase !== undefined) params.phase = phase;
      return params;
    },
    () =>
      S.object(
        {
          materialId: S.id('material to apply to every slab'),
          levelId: S.id('level to finish (omit for level-unassigned geometry)'),
          surface: S.enum(
            ['top', 'bottom'],
            'top = floor, bottom = ceiling (default top)',
          ),
          phase: phaseField,
        },
        ['materialId'],
      ),
  ),
  execute(ctx, params) {
    if (!ctx.doc.materials.has(params.materialId)) {
      throw new ValidationError(`material ${params.materialId} does not exist`);
    }
    const levelId = params.levelId ?? null;
    const phase: Phase = params.phase ?? 'new';
    const anchorIdx = anchorIndexForSurface(params.surface ?? 'top');
    const onLevel = (slab: SlabEntity): boolean =>
      levelId === null ||
      slab.baseLevelId === null ||
      slab.baseLevelId === levelId;

    // remove prior auto finishes whose host slab is on this level (matching the
    // surface AND phase), leaving wall finishes, the other surface, and the
    // other phase untouched
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (!(entity instanceof FinishEntity) || !entity.auto) continue;
      if (entity.phase !== phase) continue;
      const relation = ctx.doc.relations.relationOfHosted(entity.id);
      const host = relation ? ctx.doc.get(relation.hostId) : null;
      if (
        host instanceof SlabEntity &&
        onLevel(host) &&
        relation!.anchorIndex === anchorIdx
      ) {
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
      finish.phase = phase;
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
  registry.register(UpdateFinishCommand);
  registry.register(AutoFinishCommand);
  registry.register(AddFloorFinishCommand);
  registry.register(AutoFloorFinishCommand);
}
