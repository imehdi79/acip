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
import { asId, asIdArray, asNumber, asPoint, asPositive } from './validate.js';

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
  layerId?: LayerId;
}

export const AddWindowCommand: Command<AddWindowParams, EntityId> = {
  name: 'WINDOW.ADD',
  description:
    'Place a window in a wall at parametric position t along its baseline. The window follows the wall when it moves. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddWindowParams = {
        wallId: asId(raw['wallId'], 'wallId'),
        t: asNumber(raw['t'], 't'),
        width: asPositive(raw['width'], 'width', 1.0),
        sill: asNumber(raw['sill'], 'sill', 0.9),
        height: asPositive(raw['height'], 'height', 1.2),
      };
      if (raw['layerId'] !== undefined)
        params.layerId = asId(raw['layerId'], 'layerId') as string as LayerId;
      return params;
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
          layerId: S.id('optional layer id; defaults to the active layer'),
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
    // an opening carries its own layer rather than inheriting the host's:
    // hiding a batch of work has to take the windows in it with the walls
    if (params.layerId !== undefined) window.layerId = params.layerId;
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
  layerId?: LayerId;
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
      if (raw['layerId'] !== undefined)
        params.layerId = asId(raw['layerId'], 'layerId') as string as LayerId;
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
          layerId: S.id('optional layer id; defaults to the active layer'),
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
    if (params.layerId !== undefined) door.layerId = params.layerId;
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

export interface ResizeOpeningParams {
  id: EntityId;
  width: number;
}

/** the numbers-first companion to OPENING.MOVE: set an opening's width */
export const ResizeOpeningCommand: Command<ResizeOpeningParams, void> = {
  name: 'OPENING.RESIZE',
  description:
    'Set the width in meters of a hosted window or door (its position along the wall is unchanged).',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      return {
        id: asId(raw['id'], 'id'),
        width: asPositive(raw['width'], 'width'),
      };
    },
    () =>
      S.object(
        {
          id: S.id('window or door entity id'),
          width: S.number('opening width in meters, greater than 0'),
        },
        ['id', 'width'],
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
      (opening as HostedOpeningEntity).width = params.width;
    });
  },
};

export interface SetWallPropsParams {
  ids: EntityId[];
  thickness?: number;
  height?: number;
}

/**
 * Set the raw thickness and/or height of walls. Height is always local.
 * Thickness only shows when the wall has no assembly type (a typed wall derives
 * thickness from its layers), so setting thickness clears the assigned type —
 * the direct number wins over the assembly.
 */
export const SetWallPropsCommand: Command<SetWallPropsParams, number> = {
  name: 'WALL.SETPROPS',
  description:
    'Set the thickness and/or height in meters of one or more walls. Setting ' +
    'thickness clears any assigned type so the raw thickness applies (a typed ' +
    'wall otherwise derives thickness from its assembly). Returns how many ' +
    'walls changed.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: SetWallPropsParams = { ids: asIdArray(raw['ids'], 'ids') };
      if (raw['thickness'] !== undefined) {
        params.thickness = asPositive(raw['thickness'], 'thickness');
      }
      if (raw['height'] !== undefined) {
        params.height = asPositive(raw['height'], 'height');
      }
      return params;
    },
    () =>
      S.object(
        {
          ids: S.array(S.id('wall id'), 'walls to update'),
          thickness: S.number(
            'wall thickness in meters (clears the assigned type)',
          ),
          height: S.number('wall height in meters'),
        },
        ['ids'],
      ),
  ),
  execute(ctx, params) {
    let count = 0;
    for (const id of params.ids) {
      const entity = ctx.doc.get(id);
      if (!(entity instanceof WallEntity)) continue;
      ctx.tx.update(entity, (e) => {
        const wall = e as WallEntity;
        if (params.thickness !== undefined) {
          wall.thickness = params.thickness;
          wall.typeRef = undefined; // raw thickness only applies without a type
        }
        if (params.height !== undefined) {
          wall.vertical = { height: params.height };
        }
      });
      count += 1;
    }
    return count;
  },
};

export interface SetWallJogParams {
  ids: EntityId[];
  /** which end steps */
  which: 'start' | 'end';
  /** how far it steps sideways, in meters; 0 takes the jog off */
  offset: number;
}

/**
 * Step one end of a wall sideways.
 *
 * A jog is the small offset where two runs of wall meet out of line — one face
 * carries on past the corner while the other steps in. It is the per-corner
 * override deferred beyond joins V2 (docs/editor-core/04-systems/
 * wall-joins.md): joins stay derived, and this is the one thing about a
 * junction the drawing cannot work out for itself because it is a decision
 * rather than a consequence.
 *
 * The baseline does not move. A jogged end simply stops mitering and steps
 * instead, so lengths, joins, snapping and grips all go on reading the two
 * points they always did.
 *
 * Signed along the wall's own +normal, so the SAME number means opposite sides
 * on two walls pointing opposite ways. That is the honest way round: the sign
 * belongs to the wall it is stored on, and a caller that wants "toward the
 * room" has to say which way that is for this wall.
 *
 * Zero removes it, and removing is the whole undo story — nothing else about
 * the wall was touched.
 */
export const SetWallJogCommand: Command<SetWallJogParams, number> = {
  name: 'WALL.SETJOG',
  description:
    'Step one end of one or more walls sideways by a signed distance in ' +
    'meters (positive is toward the wall +normal), so the corner steps ' +
    'instead of mitering. Pass 0 to remove the jog. Returns how many walls ' +
    'changed.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const which = raw['which'];
      if (which !== 'start' && which !== 'end') {
        throw new ValidationError("which must be 'start' or 'end'");
      }
      return {
        ids: asIdArray(raw['ids'], 'ids'),
        which,
        offset: asNumber(raw['offset'], 'offset'),
      };
    },
    () =>
      S.object(
        {
          ids: S.array(S.id('wall id'), 'walls to update'),
          which: S.string("which end steps: 'start' or 'end'"),
          offset: S.number(
            'sideways step in meters, signed along the wall +normal; 0 removes it',
          ),
        },
        ['ids', 'which', 'offset'],
      ),
  ),
  execute(ctx, params) {
    let count = 0;
    for (const id of params.ids) {
      const entity = ctx.doc.get(id);
      if (!(entity instanceof WallEntity)) continue;
      ctx.tx.update(entity, (e) => {
        (e as WallEntity).setJog(params.which, params.offset);
      });
      count += 1;
    }
    return count;
  },
};

export interface SetOpeningPropsParams {
  ids: EntityId[];
  width?: number;
  height?: number;
  sill?: number;
  thickness?: number;
}

/**
 * Set the stored sizes of hosted openings — the numbers-first companion to
 * OPENING.MOVE and OPENING.RESIZE, which between them reach only t and width.
 *
 * A door's sill is not a stored number that happens to be zero: getSillHeight
 * returns a literal 0, so there is nowhere to put another value. A non-zero
 * sill aimed at a door is therefore REJECTED rather than dropped — silently
 * discarding a number the caller passed is the worse failure, and the throw
 * rolls the whole transaction back, so no opening is left half-edited.
 */
export const SetOpeningPropsCommand: Command<SetOpeningPropsParams, number> = {
  name: 'OPENING.SETPROPS',
  description:
    'Set the width, height, sill height and/or frame thickness in meters of ' +
    'one or more hosted windows and doors. A door has no sill (it opens at ' +
    'floor level), so only 0 is accepted for one. Thickness is the frame ' +
    'depth through the wall, stored for later 3D work and drawn nowhere. ' +
    'Returns how many openings changed.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: SetOpeningPropsParams = {
        ids: asIdArray(raw['ids'], 'ids'),
      };
      if (raw['width'] !== undefined) {
        params.width = asPositive(raw['width'], 'width');
      }
      if (raw['height'] !== undefined) {
        params.height = asPositive(raw['height'], 'height');
      }
      // a sill sits ON the floor at 0, so this is the one size where zero is
      // an answer rather than a mistake
      if (raw['sill'] !== undefined) {
        const sill = asNumber(raw['sill'], 'sill');
        if (sill < 0) throw new ValidationError('sill must be 0 or greater');
        params.sill = sill;
      }
      if (raw['thickness'] !== undefined) {
        params.thickness = asPositive(raw['thickness'], 'thickness');
      }
      return params;
    },
    () =>
      S.object(
        {
          ids: S.array(S.id('window or door id'), 'openings to update'),
          width: S.number('opening width in meters, along the wall'),
          height: S.number('opening height in meters'),
          sill: S.number(
            'height of the opening bottom above the wall base in meters (doors are always 0)',
          ),
          thickness: S.number('frame depth through the wall in meters'),
        },
        ['ids'],
      ),
  ),
  execute(ctx, params) {
    let count = 0;
    for (const id of params.ids) {
      const entity = ctx.doc.get(id);
      if (!(entity instanceof HostedOpeningEntity)) continue;
      // WindowEntity is the only opening that stores a sill today; anything
      // else inherits the fixed 0 and cannot hold one
      const hasSill = entity instanceof WindowEntity;
      if (params.sill !== undefined && params.sill !== 0 && !hasSill) {
        throw new ValidationError(
          `entity ${id} is a ${entity.type}: it opens at floor level and has no sill`,
        );
      }
      ctx.tx.update(entity, (e) => {
        const opening = e as HostedOpeningEntity;
        if (params.width !== undefined) opening.width = params.width;
        if (params.height !== undefined) opening.height = params.height;
        if (params.thickness !== undefined) {
          opening.thickness = params.thickness;
        }
        if (params.sill !== undefined && opening instanceof WindowEntity) {
          opening.sill = params.sill;
        }
      });
      count += 1;
    }
    return count;
  },
};

export interface SetDoorHangParams {
  ids: EntityId[];
  swing?: 1 | -1;
  hinge?: 1 | -1;
}

/**
 * How a door hangs: which face it opens onto (`swing`) and which jamb it is
 * hinged on (`hinge`). The two together are the four ways a joiner can hang
 * one, and they are set through a single command because on site they are one
 * decision — you do not choose a swing without choosing a side to hang it.
 */
export const SetDoorHangCommand: Command<SetDoorHangParams, number> = {
  name: 'DOOR.SETHANG',
  description:
    'Set which side of the wall a door opens onto (swing: 1 or -1) and which ' +
    'jamb it is hinged on (hinge: -1 = the end the wall runs from, 1 = the ' +
    'end it runs to). Returns how many doors changed.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: SetDoorHangParams = { ids: asIdArray(raw['ids'], 'ids') };
      for (const key of ['swing', 'hinge'] as const) {
        if (raw[key] === undefined) continue;
        if (raw[key] !== 1 && raw[key] !== -1) {
          throw new ValidationError(`${key} must be 1 or -1`);
        }
        params[key] = raw[key];
      }
      return params;
    },
    () =>
      S.object(
        {
          ids: S.array(S.id('door id'), 'doors to rehang'),
          swing: S.enum([1, -1], 'side of the wall the leaf opens onto'),
          hinge: S.enum([1, -1], 'jamb the leaf is hinged on'),
        },
        ['ids'],
      ),
  ),
  execute(ctx, params) {
    let count = 0;
    for (const id of params.ids) {
      const entity = ctx.doc.get(id);
      // windows have no leaf to hang; skipping keeps a mixed selection usable
      if (!(entity instanceof DoorEntity)) continue;
      ctx.tx.update(entity, (e) => {
        const door = e as DoorEntity;
        if (params.swing !== undefined) door.swing = params.swing;
        if (params.hinge !== undefined) door.hinge = params.hinge;
      });
      count += 1;
    }
    return count;
  },
};

export function registerArchitectureCommands(registry: CommandRegistry): void {
  registry.register(AddWallCommand);
  registry.register(AddWindowCommand);
  registry.register(AddDoorCommand);
  registry.register(MoveOpeningCommand);
  registry.register(ResizeOpeningCommand);
  registry.register(SetOpeningPropsCommand);
  registry.register(SetWallPropsCommand);
  registry.register(SetWallJogCommand);
  registry.register(SetDoorHangCommand);
}
