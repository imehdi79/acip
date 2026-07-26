import type { EntityId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import { FinishEntity } from '../entities/architecture/finish-entity.js';
import { HostedOpeningEntity } from '../entities/architecture/hosted-opening.js';
import type { Phase } from '../entities/architecture/phase.js';
import { PHASES, isPhase } from '../entities/architecture/phase.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asIdArray } from './validate.js';

export interface SetPhaseParams {
  ids: EntityId[];
  phase: Phase;
}

/**
 * Move finishes and openings between the `new` (build) and `demolish` (remove)
 * phases. A finish flipped to `demolish` keeps its band/footprint and quantity
 * but prices as a strip-out; a window/door flipped to `demolish` is an existing
 * opening to be taken out. The one hook the renovation half needs — everything
 * else (area math, hosting, cascade) is unchanged. Returns how many changed.
 */
export const SetPhaseCommand: Command<SetPhaseParams, number> = {
  name: 'PHASE.SET',
  description:
    'Set the construction phase of finishes and/or openings (windows, doors): ' +
    "'new' = build/install, 'demolish' = existing fabric to be removed (priced " +
    'as demolition). Use it to mark tile bands, floors, or windows for tear-out ' +
    'in a renovation. Returns how many entities changed.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const phase = raw['phase'];
      if (!isPhase(phase)) {
        throw new ValidationError(`phase must be one of ${PHASES.join(', ')}`);
      }
      return { ids: asIdArray(raw['ids'], 'ids'), phase };
    },
    () =>
      S.object(
        {
          ids: S.array(
            S.id('finish, window, or door id'),
            'entities to move between phases',
          ),
          phase: S.enum(
            PHASES,
            "'new' = build/install; 'demolish' = existing, to be removed",
          ),
        },
        ['ids', 'phase'],
      ),
  ),
  execute(ctx, params) {
    let count = 0;
    for (const id of params.ids) {
      const entity = ctx.doc.get(id);
      if (
        !(entity instanceof FinishEntity) &&
        !(entity instanceof HostedOpeningEntity)
      ) {
        continue;
      }
      ctx.tx.update(entity, (e) => {
        (e as FinishEntity | HostedOpeningEntity).phase = params.phase;
      });
      count += 1;
    }
    return count;
  },
};

export function registerPhaseCommands(registry: CommandRegistry): void {
  registry.register(SetPhaseCommand);
}
