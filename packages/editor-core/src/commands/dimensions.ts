import type { EntityId, LayerId, LevelId } from '../common/id.js';
import { ValidationError } from '../common/errors.js';
import type { Point } from '../geometry/primitives/point.js';
import { cross, dot, normalize, sub } from '../geometry/primitives/point.js';
import { bboxUnion } from '../geometry/primitives/bbox.js';
import type { BBox } from '../geometry/primitives/bbox.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';
import type { DimWallSide } from '../entities/annotations/dimension-entity.js';
import { DimensionEntity } from '../entities/annotations/dimension-entity.js';
import { detectSpaces } from '../measurements/spaces.js';
import type { Command } from './command.js';
import { paramsSchema } from './command.js';
import type { CommandRegistry } from './command-registry.js';
import { S } from './schema.js';
import { asId, asNumber, asPoint } from './validate.js';

const INNER_OFFSET = 0.35;
const OUTER_OFFSET = 0.6;
/** net-boundary edges shorter than this are jogs/notches, not room widths */
const MIN_INNER_EDGE = 0.5;

function asSide(value: unknown, name: string): DimWallSide {
  if (value === undefined) return 'axis';
  if (value === 'axis' || value === 'face+' || value === 'face-') return value;
  throw new ValidationError(`${name} must be 'axis', 'face+' or 'face-'`);
}

export interface AddDimensionParams {
  a?: Point;
  b?: Point;
  wallA?: EntityId;
  sideA?: DimWallSide;
  wallB?: EntityId;
  sideB?: DimWallSide;
  t?: number;
  offset?: number;
  levelId?: LevelId;
  layerId?: LayerId;
}

export const AddDimensionCommand: Command<AddDimensionParams, EntityId> = {
  name: 'DIM.ADD',
  description:
    'Create a linear dimension. Either between two points (a, b), or bound to two walls ' +
    '(wallA/wallB with sideA/sideB: axis | face+ | face-) measuring the clear distance ' +
    "from wall A's side line to wall B's — face-bound dimensions re-measure when walls " +
    'move or their assembly thickness changes. Returns the new entity id.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AddDimensionParams = {};
      if (raw['a'] !== undefined) params.a = asPoint(raw['a'], 'a');
      if (raw['b'] !== undefined) params.b = asPoint(raw['b'], 'b');
      if (raw['wallA'] !== undefined)
        params.wallA = asId(raw['wallA'], 'wallA') as EntityId;
      if (raw['wallB'] !== undefined)
        params.wallB = asId(raw['wallB'], 'wallB') as EntityId;
      params.sideA = asSide(raw['sideA'], 'sideA');
      params.sideB = asSide(raw['sideB'], 'sideB');
      if (raw['t'] !== undefined) params.t = asNumber(raw['t'], 't');
      if (raw['offset'] !== undefined)
        params.offset = asNumber(raw['offset'], 'offset');
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['layerId'] !== undefined) {
        params.layerId = asId(raw['layerId'], 'layerId') as string as LayerId;
      }
      const points = params.a !== undefined && params.b !== undefined;
      const walls = params.wallA !== undefined && params.wallB !== undefined;
      if (points === walls) {
        throw new ValidationError(
          'provide either both a and b, or both wallA and wallB',
        );
      }
      return params;
    },
    () =>
      S.object({
        a: S.point('first point (points mode)'),
        b: S.point('second point (points mode)'),
        wallA: S.id('first wall id (walls mode)'),
        sideA: S.enum(
          ['axis', 'face+', 'face-'],
          "wall A's measured side (default axis)",
        ),
        wallB: S.id('second wall id (walls mode)'),
        sideB: S.enum(
          ['axis', 'face+', 'face-'],
          "wall B's measured side (default axis)",
        ),
        t: S.number(
          "anchor parameter along wall A's baseline, 0..1 (default 0.5)",
        ),
        offset: S.number(
          'signed dimension-line offset in meters (default 0.5)',
        ),
        levelId: S.id('optional level the dimension belongs to'),
        layerId: S.id('optional layer id; defaults to the active layer'),
      }),
  ),
  execute(ctx, params) {
    const dim = new DimensionEntity();
    if (params.a !== undefined && params.b !== undefined) {
      dim.def = { kind: 'points', a: params.a, b: params.b };
    } else {
      for (const id of [params.wallA!, params.wallB!]) {
        if (!(ctx.doc.get(id) instanceof WallEntity)) {
          throw new ValidationError(`${id} is not a wall`);
        }
      }
      const t = params.t ?? 0.5;
      if (t < 0 || t > 1) throw new ValidationError('t must be within 0..1');
      dim.def = {
        kind: 'walls',
        wallA: params.wallA!,
        sideA: params.sideA ?? 'axis',
        wallB: params.wallB!,
        sideB: params.sideB ?? 'axis',
        t,
      };
    }
    if (params.offset !== undefined) dim.offset = params.offset;
    if (params.levelId !== undefined) dim.baseLevelId = params.levelId;
    if (params.layerId !== undefined) dim.layerId = params.layerId;
    ctx.tx.create(dim);
    return dim.id;
  },
};

/** drop collinear pass-through points; keep corners and spike reversals */
function mergeCollinear(points: readonly Point[]): Point[] {
  const n = points.length;
  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const v1 = normalize(sub(points[i], points[(i - 1 + n) % n]));
    const v2 = normalize(sub(points[(i + 1) % n], points[i]));
    if (Math.abs(cross(v1, v2)) > 1e-6 || dot(v1, v2) < 0) {
      out.push(points[i]);
    }
  }
  return out;
}

export interface AutoDimensionParams {
  levelId?: LevelId;
  inner?: boolean;
  outer?: boolean;
}

/**
 * Regenerate, don't maintain: deletes every dimension it previously created
 * on the level, then rebuilds from current geometry — one transaction, one
 * undo, idempotent under re-run. Inner clear widths come from detected
 * spaces (net boundaries already sit on inner wall faces); outer overall
 * extents from the union of wall bounds (thickness included).
 */
export const AutoDimensionCommand: Command<
  AutoDimensionParams,
  { removed: number; created: number }
> = {
  name: 'DIM.AUTO',
  description:
    'Auto-dimension a level: inner clear-width dimensions per detected room (measured ' +
    'between inner wall faces) and overall outer extents (wall thickness included). ' +
    'Re-running replaces previously auto-created dimensions. Returns {removed, created}.',
  params: paramsSchema(
    (input) => {
      const raw = (input ?? {}) as Record<string, unknown>;
      const params: AutoDimensionParams = {};
      if (raw['levelId'] !== undefined) {
        params.levelId = asId(raw['levelId'], 'levelId') as string as LevelId;
      }
      if (raw['inner'] !== undefined) params.inner = raw['inner'] === true;
      if (raw['outer'] !== undefined) params.outer = raw['outer'] === true;
      return params;
    },
    () =>
      S.object({
        levelId: S.id(
          'level to dimension (omit for level-unassigned geometry)',
        ),
        inner: S.boolean('room clear-width dimensions (default true)'),
        outer: S.boolean('overall extent dimensions (default true)'),
      }),
  ),
  execute(ctx, params) {
    const levelId = params.levelId ?? null;
    let removed = 0;
    for (const entity of ctx.doc.all()) {
      if (
        entity instanceof DimensionEntity &&
        entity.auto &&
        entity.baseLevelId === levelId
      ) {
        ctx.tx.remove(entity);
        removed += 1;
      }
    }

    let created = 0;
    const place = (a: Point, b: Point, offset: number): void => {
      const dim = new DimensionEntity();
      dim.def = { kind: 'points', a, b };
      dim.offset = offset;
      dim.auto = true;
      dim.baseLevelId = levelId;
      ctx.tx.create(dim);
      created += 1;
    };

    if (params.inner !== false) {
      for (const space of detectSpaces(ctx.doc, levelId)) {
        const corners = mergeCollinear(space.boundary);
        const n = corners.length;
        // one dimension per boundary direction — the longest edge wins
        const longestByDirection = new Map<
          number,
          { a: Point; b: Point; len: number }
        >();
        for (let i = 0; i < n; i++) {
          const a = corners[i];
          const b = corners[(i + 1) % n];
          const d = sub(b, a);
          const len = Math.hypot(d.x, d.y);
          if (len < MIN_INNER_EDGE) continue;
          let angle = Math.atan2(d.y, d.x);
          if (angle < 0) angle += Math.PI;
          if (angle >= Math.PI - 1e-6) angle = 0;
          const bucket = Math.round((angle * 180) / Math.PI);
          const known = longestByDirection.get(bucket);
          if (!known || len > known.len)
            longestByDirection.set(bucket, { a, b, len });
        }
        for (const edge of longestByDirection.values()) {
          // net boundaries are counter-clockwise: +offset points into the room
          place(edge.a, edge.b, INNER_OFFSET);
        }
      }
    }

    if (params.outer !== false) {
      let bounds: BBox | null = null;
      for (const entity of ctx.doc.all()) {
        if (!(entity instanceof WallEntity)) continue;
        if (
          levelId !== null &&
          entity.baseLevelId !== null &&
          entity.baseLevelId !== levelId
        ) {
          continue;
        }
        bounds = bounds
          ? bboxUnion(bounds, entity.getBounds())
          : entity.getBounds();
      }
      if (
        bounds &&
        bounds.maxX - bounds.minX > 1e-6 &&
        bounds.maxY - bounds.minY > 1e-6
      ) {
        // overall width below the plan, overall height to its left
        place(
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.maxX, y: bounds.minY },
          -OUTER_OFFSET,
        );
        place(
          { x: bounds.minX, y: bounds.minY },
          { x: bounds.minX, y: bounds.maxY },
          OUTER_OFFSET,
        );
      }
    }

    return { removed, created };
  },
};

export function registerDimensionCommands(registry: CommandRegistry): void {
  registry.register(AddDimensionCommand);
  registry.register(AutoDimensionCommand);
}
