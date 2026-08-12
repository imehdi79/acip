import type { EntityId, LayerId, LevelId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { pointInLoop } from '../topology/arrangement.js';
import { SpaceTagEntity } from '../entities/annotations/space-tag-entity.js';
import { detectSpaces, findSpaceTag } from '../measurements/spaces.js';
import { isEntityInteractive } from '../views/index.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asPoint } from './validate.js';

export interface SetSpaceNameParams {
  at: Point;
  name: string;
  levelId?: LevelId;
  layerId?: LayerId;
}

/**
 * Name a room. Rooms are detected, not stored, so there is nothing on the room
 * to set — the name goes on a tag anchored inside it (SpaceTagEntity), which is
 * how the space docs always said naming would land. Naming an already-named
 * room renames its tag rather than stacking a second one, and an empty name
 * removes it, so the command is idempotent in both directions.
 *
 * The tag lands on `layerId` like any other new entity. A name is a piece of
 * drawing, not a property of the model: written onto a layer that is later
 * hidden it goes with it, which is what lets a room be renamed as part of a
 * marked-up change rather than silently over the plan being marked up.
 *
 * An existing tag on a LOCKED layer is not renamed or removed. The lock is the
 * whole of "this drawing is not yours to edit", and a room's name is part of
 * the drawing — reaching through it here would be the one way left to rewrite
 * a plan that every other path refuses to touch.
 */
export const SetSpaceNameCommand: Command<SetSpaceNameParams, EntityId | null> =
  {
    name: 'SPACE.SETNAME',
    description:
      'Name the room (detected space) containing the point `at`. An empty name clears the name. Returns the id of the tag holding the name, or null if it was cleared.',
    params: paramsSchema(
      (input) => {
        const raw = (input ?? {}) as Record<string, unknown>;
        if (typeof raw['name'] !== 'string') {
          throw new ValidationError('name must be a string');
        }
        const params: SetSpaceNameParams = {
          at: asPoint(raw['at'], 'at'),
          name: raw['name'],
        };
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
            at: S.point('any point inside the room to name'),
            name: S.string('room name; empty clears it'),
            levelId: S.id('optional level to detect rooms on; default all'),
            layerId: S.id('optional layer for the name tag; default active'),
          },
          ['at', 'name'],
        ),
    ),
    execute(ctx, params) {
      const levelId = params.levelId ?? null;
      const space = detectSpaces(ctx.doc, levelId).find((candidate) =>
        pointInLoop(params.at, candidate.boundary),
      );
      if (!space) {
        throw new ValidationError(
          `no room contains (${params.at.x}, ${params.at.y}) — rooms are bounded by a closed loop of walls`,
        );
      }

      const existing = findSpaceTag(ctx.doc, space);
      if (existing && !isEntityInteractive(ctx.doc, existing)) {
        throw new ValidationError(
          `the name of the room at (${params.at.x}, ${params.at.y}) is on a locked layer`,
        );
      }
      const name = params.name.trim();
      if (name === '') {
        if (existing) ctx.tx.remove(existing);
        return null;
      }
      if (existing) {
        ctx.tx.update(existing, (tag) => {
          tag.name = name;
        });
        return existing.id;
      }

      const tag = new SpaceTagEntity();
      tag.name = name;
      // the room's own label anchor, so the name sits where the area already
      // does and survives edits that keep that point inside the room
      tag.setPoint(space.labelPoint);
      tag.baseLevelId = levelId;
      if (params.layerId !== undefined) tag.layerId = params.layerId;
      ctx.tx.create(tag);
      return tag.id;
    },
  };

export function registerSpaceCommands(registry: CommandRegistry): void {
  registry.register(SetSpaceNameCommand);
}
