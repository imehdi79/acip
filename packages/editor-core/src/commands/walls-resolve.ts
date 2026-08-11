import type { EntityId, LevelId } from '../common/id.js';
import type { Point } from '../geometry/primitives/point.js';
import { distance, lerp } from '../geometry/primitives/point.js';
import { closestPointOnSegment } from '../geometry/curves/segment.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import { HostedOpeningEntity } from '../entities/architecture/hosted-opening.js';
import type { OverlapSegment, SegmentPiece } from '../topology/overlaps.js';
import { isUnchanged, planSegmentOverlaps } from '../topology/overlaps.js';
import { JOIN_TOLERANCE } from '../topology/junctions.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId } from './validate.js';

export interface ResolveWallsParams {
  levelId?: LevelId;
}

export interface ResolveWallsResult {
  /** walls whose baseline was shortened to their first kept piece */
  readonly split: EntityId[];
  /** walls created for the remaining pieces */
  readonly created: EntityId[];
  /** walls erased because every part of them was already covered */
  readonly removed: EntityId[];
}

/** the piece whose body the point sits on, else the nearest one */
function pieceFor(pieces: readonly SegmentPiece[], p: Point): number {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < pieces.length; i++) {
    const d = distance(p, closestPointOnSegment(p, pieces[i].a, pieces[i].b));
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}

/** where `p` falls along the piece, clamped to it */
function paramOn(piece: SegmentPiece, p: Point): number {
  const len = distance(piece.a, piece.b);
  if (len < JOIN_TOLERANCE) return 0.5;
  const foot = closestPointOnSegment(p, piece.a, piece.b);
  return Math.min(1, Math.max(0, distance(piece.a, foot) / len));
}

/**
 * Make the walls cover each stretch of the plan exactly once.
 *
 * Walls that cross, tee, or run over each other are split at those points, and
 * where two walls cover the same stretch only the FIRST — the older wall, in
 * document order — keeps it. The wall being split keeps its id (and so its
 * mark, type, level, layer and history) for its first piece; the rest become
 * new walls cloned from it. A wall whose every piece is already covered is
 * erased, because it is a duplicate in full rather than in part.
 *
 * Hosted openings move to whichever resulting piece their centre now sits on,
 * with `t` remapped, so a window never ends up on the wrong side of a new cut.
 */
export const ResolveWallsCommand: Command<
  ResolveWallsParams,
  ResolveWallsResult
> = {
  name: 'WALL.RESOLVE',
  description:
    'Split walls at their crossings, tees and overlaps so no stretch of the plan is covered by two walls. Ids are preserved where possible and hosted openings follow their piece. Returns the walls split, created and removed.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: ResolveWallsParams = {};
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      return params;
    },
    () =>
      S.object({
        levelId: S.id('optional level to resolve; default every wall'),
      }),
  ),
  execute(ctx, params) {
    const levelId = params.levelId ?? null;
    const walls: WallEntity[] = [];
    for (const entity of ctx.doc.all()) {
      if (!(entity instanceof WallEntity)) continue;
      if (
        levelId !== null &&
        entity.baseLevelId !== null &&
        entity.baseLevelId !== levelId
      )
        continue;
      walls.push(entity);
    }

    const segments: OverlapSegment[] = walls.map((wall) => {
      const { a, b } = wall.getBaseline();
      return { id: wall.id as string, a, b };
    });
    const plans = planSegmentOverlaps(segments, JOIN_TOLERANCE);
    const byId = new Map(walls.map((wall) => [wall.id as string, wall]));

    const result: ResolveWallsResult = { split: [], created: [], removed: [] };
    for (const plan of plans) {
      const wall = byId.get(plan.id);
      if (!wall || isUnchanged(plan)) continue;

      const original = wall.getBaseline();
      const openings: { entity: HostedOpeningEntity; at: Point }[] = [];
      for (const relation of ctx.doc.relations.relationsOfHost(wall.id)) {
        const hosted = ctx.doc.get(relation.hostedId);
        if (hosted instanceof HostedOpeningEntity) {
          openings.push({
            entity: hosted,
            at: lerp(original.a, original.b, hosted.t),
          });
        }
      }

      if (plan.keep.length === 0) {
        // covered in full by an earlier wall — ENTITY.ERASE's cascade rules
        // apply, so its openings go with it
        for (const relation of ctx.doc.relations.relationsOfHost(wall.id)) {
          const hosted = ctx.doc.get(relation.hostedId);
          if (hosted) ctx.tx.remove(hosted);
        }
        ctx.tx.remove(wall);
        (result.removed as EntityId[]).push(wall.id);
        continue;
      }

      // the original keeps its id and takes the first piece
      ctx.tx.update(wall, (w) => {
        w.setBaseline(plan.keep[0].a, plan.keep[0].b);
      });
      (result.split as EntityId[]).push(wall.id);

      const pieceWalls: WallEntity[] = [wall];
      for (const piece of plan.keep.slice(1)) {
        const copy = wall.clone() as WallEntity;
        copy.setBaseline(piece.a, piece.b);
        ctx.tx.create(copy);
        pieceWalls.push(copy);
        (result.created as EntityId[]).push(copy.id);
      }

      for (const { entity, at } of openings) {
        const index = pieceFor(plan.keep, at);
        const host = pieceWalls[index];
        const t = paramOn(plan.keep[index], at);
        if (host.id !== wall.id) {
          const relation = ctx.doc.relations.relationOfHosted(entity.id);
          if (relation) ctx.tx.detach(relation.id);
          ctx.tx.attach(host.id, entity.id, 0, {});
        }
        ctx.tx.update(entity, (opening) => {
          (opening as HostedOpeningEntity).t = t;
        });
      }
    }
    return result;
  },
};

export function registerWallResolveCommands(registry: CommandRegistry): void {
  registry.register(ResolveWallsCommand);
}
