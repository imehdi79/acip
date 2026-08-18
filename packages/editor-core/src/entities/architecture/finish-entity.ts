import { Entity } from '../base/entity.js';
import type { EntityId, MaterialId, RelationId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { lerp } from '../../geometry/primitives/point.js';
import { distanceToSegment } from '../../geometry/curves/segment.js';
import { distanceToPolyline } from '../../geometry/curves/polyline.js';
import { pointInLoop } from '../../topology/arrangement.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import type { SegmentShape, Geometry } from '../../geometry/shapes.js';
import type {
  Anchor,
  IHosted,
  Placement,
  PlacementParams,
} from '../base/capabilities.js';
import { isHost } from '../base/capabilities.js';
import { WallEntity } from './wall-entity.js';
import { SlabEntity } from './slab-entity.js';
import type { Phase } from './phase.js';
import { asPhase } from './phase.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

const DEFAULT_THICKNESS = 0.01;

/**
 * A surface finish: a material applied to a surface of one host. Two hosts:
 *
 * - a WALL FACE (`face+`/`face-` anchor) — a band `[t0·L, t1·L] × [sill, top]`
 *   whose area subtracts overlapping openings.
 * - a SLAB (`top` = floor finish, `bottom` = ceiling) — the whole footprint.
 *
 * Either way it follows its host and cascades with it, and prices through the
 * same unit-aware layerQuantity as an assembly layer. Quantities read
 * getNetArea(), never the plan line. See docs/editor-core/04-systems/finishes.md.
 */
export class FinishEntity extends Entity implements IHosted {
  static readonly TYPE = 'finish';

  readonly type: string = FinishEntity.TYPE;

  materialId: MaterialId | null = null;
  /** bottom of a wall-face band above the wall base (ignored for slabs) */
  sillHeight = 0;
  /** top of a wall-face band; null = full wall height (ignored for slabs) */
  topHeight: number | null = null;
  /** along-wall extent as baseline parameters (ignored for slabs) */
  t0 = 0;
  t1 = 1;
  /** nominal build-up thickness — only the m³ unit uses it */
  thickness = DEFAULT_THICKNESS;
  /**
   * Whether the openings crossing this band come OUT of its area.
   *
   * True is the measured-net convention and stays the default: plaster does
   * not go where a window is. False is the solid ("توپر") convention, in which
   * a face is priced over its full extent and doors and windows are billed as
   * their own items instead — the same choice `solidWallRule` offers a whole
   * bill, brought down to one layer, because the two conventions genuinely
   * coexist in one estimate: the blockwork behind a window may be measured
   * solid while the paint over it is not.
   *
   * Only a wall band has openings to argue about; on a slab it is inert.
   */
  deductOpenings = true;
  /**
   * The rectangle a SLAB-hosted finish covers, when it is not the whole
   * footprint. Null (either of them) means the whole slab.
   *
   * A wall finish states its extent as `[t0, t1] × [sill, top]`, anchored to
   * the host so it follows the wall when the wall moves. A slab footprint is
   * an arbitrary polygon with no such parameters to anchor against, so a
   * partial floor is given the only thing an estimator actually measures it
   * by: a width and a height, in metres, taken off the plan.
   *
   * That makes it a TAKEOFF dimension rather than a region — it does not
   * follow the slab, and it is not clipped to it. Both are deliberate. A
   * screeded area of 3 × 4 is 12 m² whether or not the room was later
   * stretched, and an estimator who types a figure larger than the drawn slab
   * has usually included a threshold or a return on purpose; silently
   * shrinking it to fit would be the drawing overruling a measurement the
   * user took.
   */
  coverWidth: number | null = null;
  coverHeight: number | null = null;
  /** `new` = build (supply+install); `demolish` = strip existing, priced to remove */
  phase: Phase = 'new';
  /** created by an AUTO macro — replaced on the next regeneration */
  auto = false;

  get hostRef(): RelationId | null {
    return this.doc?.relations.relationOfHosted(this.id)?.id ?? null;
  }

  private host(): Entity | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    return relation ? this.doc.get(relation.hostId) : null;
  }

  private anchorIndex(): number {
    return this.doc?.relations.relationOfHosted(this.id)?.anchorIndex ?? 0;
  }

  /** the wall face segment this finish sits on, from the relation's anchor */
  private faceAnchor(): SegmentShape | null {
    const host = this.host();
    if (!(host instanceof WallEntity) || !isHost(host)) return null;
    const anchor = host.getAnchors()[this.anchorIndex()];
    return anchor && anchor.geometry.kind === 'segment'
      ? anchor.geometry
      : null;
  }

  /** 'face+' | 'face-' (wall) or 'top' | 'bottom' (slab); null if unresolved */
  getSide(): string | null {
    const host = this.host();
    if (host instanceof WallEntity && isHost(host)) {
      return host.getAnchors()[this.anchorIndex()]?.name ?? null;
    }
    if (host instanceof SlabEntity) {
      return this.anchorIndex() === 1 ? 'bottom' : 'top';
    }
    return null;
  }

  getThickness(): number {
    return this.thickness;
  }

  /** reference length for m materials: wall band length, or slab perimeter */
  getCoveredLength(): number {
    const host = this.host();
    if (host instanceof WallEntity)
      return Math.max(0, (this.t1 - this.t0) * host.getLength());
    if (host instanceof SlabEntity) {
      const w = this.coverWidth;
      const h = this.coverHeight;
      // the run around what is actually covered, not around the whole slab:
      // an edge trim to a 3 × 4 tiled area is 14 m of trim, not the room's
      return w !== null && h !== null
        ? 2 * (Math.max(0, w) + Math.max(0, h))
        : host.getPerimeter();
    }
    return 0;
  }

  /** finished area (m²): wall band minus openings, or the slab footprint */
  getNetArea(): number {
    const host = this.host();
    if (host instanceof SlabEntity) {
      const w = this.coverWidth;
      const h = this.coverHeight;
      if (w !== null && h !== null) return Math.max(0, w) * Math.max(0, h);
      return host.getArea();
    }
    if (!(host instanceof WallEntity)) return 0;
    const length = host.getLength();
    const along0 = this.t0 * length;
    const along1 = this.t1 * length;
    const top = this.topHeight ?? host.getHeight();
    const bandLen = Math.max(0, along1 - along0);
    const bandHeight = Math.max(0, top - this.sillHeight);
    let area = bandLen * bandHeight;
    // measured solid: the face is priced over its whole extent and the doors
    // and windows in it are billed as their own items instead
    if (!this.deductOpenings) return Math.max(0, area);
    for (const spec of host.getOpeningSpecs()) {
      const openLen0 = spec.t * length - spec.width / 2;
      const openLen1 = spec.t * length + spec.width / 2;
      const overlapLen = Math.max(
        0,
        Math.min(along1, openLen1) - Math.max(along0, openLen0),
      );
      const openTop = spec.sill + spec.height;
      const overlapH = Math.max(
        0,
        Math.min(top, openTop) - Math.max(this.sillHeight, spec.sill),
      );
      area -= overlapLen * overlapH;
    }
    return Math.max(0, area);
  }

  /** plan symbol: the covered face sub-segment (wall) or footprint outline (slab) */
  getBaseGeometry(): Geometry {
    const host = this.host();
    if (host instanceof SlabEntity) {
      return {
        kind: 'polyline',
        points: [...host.getFootprint()],
        closed: true,
      };
    }
    const face = this.faceAnchor();
    if (!face) return { kind: 'group', children: [] };
    return {
      kind: 'segment',
      a: lerp(face.a, face.b, this.t0),
      b: lerp(face.a, face.b, this.t1),
    };
  }

  evalPlacement(anchor: Anchor, _params: PlacementParams): Placement {
    if (anchor.geometry.kind === 'segment') {
      const seg = anchor.geometry;
      return {
        position: lerp(seg.a, seg.b, (this.t0 + this.t1) / 2),
        rotation: 0,
      };
    }
    return { position: { x: 0, y: 0 }, rotation: 0 };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    if (filter && !filter.includes('endpoint')) return [];
    const host = this.host();
    if (host instanceof SlabEntity) {
      return host
        .getFootprint()
        .map((point) => ({ kind: 'endpoint', point, entityId: this.id }));
    }
    const face = this.faceAnchor();
    if (!face) return [];
    return [
      {
        kind: 'endpoint',
        point: lerp(face.a, face.b, this.t0),
        entityId: this.id,
      },
      {
        kind: 'endpoint',
        point: lerp(face.a, face.b, this.t1),
        entityId: this.id,
      },
    ];
  }

  hitTest(pt: Point, tolerance: number): boolean {
    const host = this.host();
    if (host instanceof SlabEntity) {
      const footprint = host.getFootprint();
      return (
        pointInLoop(pt, footprint) ||
        distanceToPolyline(pt, footprint, true) <= tolerance
      );
    }
    const face = this.faceAnchor();
    if (!face) return false;
    return (
      distanceToSegment(
        pt,
        lerp(face.a, face.b, this.t0),
        lerp(face.a, face.b, this.t1),
      ) <= tolerance
    );
  }

  /** a finish is bound to its host — a move is a no-op */
  transform(_m: Matrix3, _tx: Transaction): void {}

  clone(): FinishEntity {
    const copy = new FinishEntity();
    copy.layerId = this.layerId;
    copy.materialId = this.materialId;
    copy.sillHeight = this.sillHeight;
    copy.topHeight = this.topHeight;
    copy.t0 = this.t0;
    copy.t1 = this.t1;
    copy.thickness = this.thickness;
    copy.phase = this.phase;
    copy.auto = this.auto;
    copy.deductOpenings = this.deductOpenings;
    copy.coverWidth = this.coverWidth;
    copy.coverHeight = this.coverHeight;
    return copy;
  }

  protected saveProps(): JsonObject {
    return {
      materialId: this.materialId,
      sillHeight: this.sillHeight,
      topHeight: this.topHeight,
      t0: this.t0,
      t1: this.t1,
      thickness: this.thickness,
      phase: this.phase,
      auto: this.auto,
      deductOpenings: this.deductOpenings,
      coverWidth: this.coverWidth,
      coverHeight: this.coverHeight,
    };
  }

  protected loadProps(props: JsonObject, _version: number): void {
    const { sillHeight, t0, t1, thickness } = props;
    if (
      typeof sillHeight !== 'number' ||
      typeof t0 !== 'number' ||
      typeof t1 !== 'number' ||
      typeof thickness !== 'number'
    ) {
      throw new ValidationError(`finish ${this.id}: invalid props`);
    }
    this.materialId =
      typeof props['materialId'] === 'string'
        ? (props['materialId'] as MaterialId)
        : null;
    this.sillHeight = sillHeight;
    this.topHeight =
      typeof props['topHeight'] === 'number' ? props['topHeight'] : null;
    this.t0 = t0;
    this.t1 = t1;
    this.thickness = thickness;
    this.phase = asPhase(props['phase']);
    this.auto = props['auto'] === true;
    // absent means true: every drawing saved before this field existed was
    // measured net, and a missing flag must not silently re-price it solid
    this.deductOpenings = props['deductOpenings'] !== false;
    this.coverWidth =
      typeof props['coverWidth'] === 'number' ? props['coverWidth'] : null;
    this.coverHeight =
      typeof props['coverHeight'] === 'number' ? props['coverHeight'] : null;
  }
}

export function createFinishEntity(id?: EntityId): FinishEntity {
  return new FinishEntity(id);
}
