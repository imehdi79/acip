import { Entity } from '../base/entity.js';
import type { EntityId, LevelId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point, Vector } from '../../geometry/primitives/point.js';
import {
  add,
  angleOf,
  distance,
  dot,
  midpoint,
  normalize,
  perpendicular,
  point,
  scale,
  sub,
} from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import { applyToPoint } from '../../geometry/primitives/matrix3.js';
import { distanceToSegment } from '../../geometry/curves/segment.js';
import type { Geometry } from '../../geometry/shapes.js';
import { WallEntity } from '../architecture/wall-entity.js';
import type { ILevelAware } from '../base/capabilities.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

/** the two-sided rule: bind to a wall face (spaces.md convention) or its axis */
export type DimWallSide = 'axis' | 'face+' | 'face-';

export interface DimPointsDef {
  readonly kind: 'points';
  readonly a: Point;
  readonly b: Point;
}

export interface DimWallsDef {
  readonly kind: 'walls';
  readonly wallA: EntityId;
  readonly sideA: DimWallSide;
  readonly wallB: EntityId;
  readonly sideB: DimWallSide;
  /** anchor parameter along wall A's baseline (0..1) */
  readonly t: number;
}

export type DimDef = DimPointsDef | DimWallsDef;

const TEXT_HEIGHT = 0.18;
const TEXT_LIFT = 0.1;
const TICK = 0.06;
const EXT_GAP = 0.05;
const EXT_OVERRUN = 0.08;

/**
 * Linear aligned dimension. The entity stores REFERENCES, never the value:
 * measured points, extension lines, ticks, and text derive on every read.
 * `walls` mode resolves through the wall side lines, so stretching a wall or
 * changing its assembly thickness re-measures the dimension with no edit.
 * See docs/editor-core/04-systems/dimensions.md.
 */
export class DimensionEntity extends Entity implements ILevelAware {
  static readonly TYPE = 'dimension';

  readonly type: string = DimensionEntity.TYPE;

  def: DimDef = { kind: 'points', a: point(0, 0), b: point(1, 0) };
  /** signed perpendicular offset of the dimension line (+ = left of a→b) */
  offset = 0.5;
  /** created by DIM.AUTO — regenerated (deleted + rebuilt) on the next run */
  auto = false;
  baseLevelId: LevelId | null = null;
  vertical: { height: number } = { height: 0 };

  /** a wall's measurement line for one side, per the spaces.md convention */
  private sideLine(
    wall: WallEntity,
    side: DimWallSide,
  ): { p: Point; d: Vector } {
    const { a, b } = wall.getBaseline();
    const d = normalize(sub(b, a));
    if (side === 'axis') return { p: a, d };
    const off = scale(perpendicular(d), wall.getThickness() / 2);
    return side === 'face+' ? { p: add(a, off), d } : { p: sub(a, off), d };
  }

  /**
   * Measured endpoints, derived on read. `walls` mode: wall A's side line at
   * parameter t, measured to the perpendicular foot on wall B's side line.
   * Null while unresolvable (wall erased, detached, degenerate).
   */
  resolveEnds(): { a: Point; b: Point } | null {
    if (this.def.kind === 'points') return { a: this.def.a, b: this.def.b };
    const doc = this.doc;
    if (!doc) return null;
    const wallA = doc.get(this.def.wallA);
    const wallB = doc.get(this.def.wallB);
    if (!(wallA instanceof WallEntity) || !(wallB instanceof WallEntity))
      return null;
    if (wallA.getLength() < 1e-9 || wallB.getLength() < 1e-9) return null;
    const lineA = this.sideLine(wallA, this.def.sideA);
    const baseline = wallA.getBaseline();
    const anchor = add(
      lineA.p,
      scale(lineA.d, this.def.t * distance(baseline.a, baseline.b)),
    );
    const lineB = this.sideLine(wallB, this.def.sideB);
    const foot = add(
      lineB.p,
      scale(lineB.d, dot(sub(anchor, lineB.p), lineB.d)),
    );
    return { a: anchor, b: foot };
  }

  /** measured value in meters, or null while unresolvable */
  getValue(): number | null {
    const ends = this.resolveEnds();
    return ends ? distance(ends.a, ends.b) : null;
  }

  private dimLine(): { da: Point; db: Point } | null {
    const ends = this.resolveEnds();
    if (!ends || distance(ends.a, ends.b) < 1e-9) return null;
    const n = perpendicular(normalize(sub(ends.b, ends.a)));
    const off = scale(n, this.offset);
    return { da: add(ends.a, off), db: add(ends.b, off) };
  }

  getBaseGeometry(): Geometry {
    const ends = this.resolveEnds();
    if (!ends) return { kind: 'group', children: [] };
    const len = distance(ends.a, ends.b);
    if (len < 1e-9) return { kind: 'group', children: [] };
    const d = normalize(sub(ends.b, ends.a));
    const n = perpendicular(d);
    const off = scale(n, this.offset);
    const da = add(ends.a, off);
    const db = add(ends.b, off);
    // unit toward the dimension line, regardless of the offset's sign
    const u = this.offset >= 0 ? n : scale(n, -1);
    const tick = scale(normalize(add(d, u)), TICK);
    // text reads left-to-right: flip when the line points into the left half-plane
    let textAngle = angleOf(d);
    if (textAngle > Math.PI / 2 + 1e-9 || textAngle <= -Math.PI / 2 + 1e-9) {
      textAngle += Math.PI;
    }
    return {
      kind: 'group',
      children: [
        {
          kind: 'segment',
          a: add(ends.a, scale(u, EXT_GAP)),
          b: add(da, scale(u, EXT_OVERRUN)),
        },
        {
          kind: 'segment',
          a: add(ends.b, scale(u, EXT_GAP)),
          b: add(db, scale(u, EXT_OVERRUN)),
        },
        { kind: 'segment', a: da, b: db },
        { kind: 'segment', a: sub(da, tick), b: add(da, tick) },
        { kind: 'segment', a: sub(db, tick), b: add(db, tick) },
        {
          kind: 'text',
          anchor: add(midpoint(da, db), scale(u, TEXT_LIFT)),
          text: len.toFixed(2),
          height: TEXT_HEIGHT,
          rotation: textAngle,
        },
      ],
    };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    if (filter && !filter.includes('endpoint')) return [];
    const line = this.dimLine();
    if (!line) return [];
    return [
      { kind: 'endpoint', point: line.da, entityId: this.id },
      { kind: 'endpoint', point: line.db, entityId: this.id },
    ];
  }

  hitTest(pt: Point, tolerance: number): boolean {
    const line = this.dimLine();
    return (
      line !== null && distanceToSegment(pt, line.da, line.db) <= tolerance
    );
  }

  /** walls-mode dimensions are bound to their walls — a move is a no-op */
  transform(m: Matrix3, tx: Transaction): void {
    if (this.def.kind !== 'points') return;
    tx.update(this, (dim) => {
      const def = dim.def as DimPointsDef;
      dim.def = {
        kind: 'points',
        a: applyToPoint(m, def.a),
        b: applyToPoint(m, def.b),
      };
    });
  }

  clone(): DimensionEntity {
    const copy = new DimensionEntity();
    copy.layerId = this.layerId;
    copy.def = this.def;
    copy.offset = this.offset;
    copy.auto = this.auto;
    copy.baseLevelId = this.baseLevelId;
    return copy;
  }

  protected saveProps(): JsonObject {
    const def: JsonObject =
      this.def.kind === 'points'
        ? {
            kind: 'points',
            ax: this.def.a.x,
            ay: this.def.a.y,
            bx: this.def.b.x,
            by: this.def.b.y,
          }
        : {
            kind: 'walls',
            wallA: this.def.wallA,
            sideA: this.def.sideA,
            wallB: this.def.wallB,
            sideB: this.def.sideB,
            t: this.def.t,
          };
    return {
      def,
      offset: this.offset,
      auto: this.auto,
      baseLevelId: this.baseLevelId,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const def = props['def'];
    if (
      typeof props['offset'] !== 'number' ||
      def === null ||
      typeof def !== 'object'
    ) {
      throw new ValidationError(`dimension ${this.id}: invalid props`);
    }
    const raw = def as JsonObject;
    if (raw['kind'] === 'points') {
      const { ax, ay, bx, by } = raw;
      if (
        typeof ax !== 'number' ||
        typeof ay !== 'number' ||
        typeof bx !== 'number' ||
        typeof by !== 'number'
      ) {
        throw new ValidationError(`dimension ${this.id}: invalid points def`);
      }
      this.def = { kind: 'points', a: point(ax, ay), b: point(bx, by) };
    } else if (raw['kind'] === 'walls') {
      const { wallA, sideA, wallB, sideB, t } = raw;
      const isSide = (v: unknown): v is DimWallSide =>
        v === 'axis' || v === 'face+' || v === 'face-';
      if (
        typeof wallA !== 'string' ||
        typeof wallB !== 'string' ||
        !isSide(sideA) ||
        !isSide(sideB) ||
        typeof t !== 'number'
      ) {
        throw new ValidationError(`dimension ${this.id}: invalid walls def`);
      }
      this.def = {
        kind: 'walls',
        wallA: wallA as EntityId,
        sideA,
        wallB: wallB as EntityId,
        sideB,
        t,
      };
    } else {
      throw new ValidationError(`dimension ${this.id}: unknown def kind`);
    }
    this.offset = props['offset'];
    this.auto = props['auto'] === true;
    this.baseLevelId =
      typeof props['baseLevelId'] === 'string'
        ? (props['baseLevelId'] as LevelId)
        : null;
  }
}

export function createDimensionEntity(id?: EntityId): DimensionEntity {
  return new DimensionEntity(id);
}
