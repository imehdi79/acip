import { Entity } from '../base/entity.js';
import type { EntityId, MaterialId, RelationId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { ValidationError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import { lerp } from '../../geometry/primitives/point.js';
import { distanceToSegment } from '../../geometry/curves/segment.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import type { SegmentShape, Geometry } from '../../geometry/shapes.js';
import type { Anchor, IHosted, Placement, PlacementParams } from '../base/capabilities.js';
import { isHost } from '../base/capabilities.js';
import { WallEntity } from './wall-entity.js';
import type { SnapKind, SnapPoint } from '../base/snap.js';
import type { Transaction } from '../../document/history/transaction.js';

const DEFAULT_THICKNESS = 0.01;

/**
 * A surface finish: a material applied to a region of one wall's face. Hosted
 * on the wall's face+ / face- anchor (the anchor index carries the side), it
 * follows the wall and cascades with it. The finished area is a band
 * [t0·L, t1·L] × [sill, top] minus the openings that overlap it — quantities
 * read getNetArea(), never the plan line. Priced through the same unit-aware
 * layerQuantity as an assembly layer. See docs/editor-core/04-systems/finishes.md.
 */
export class FinishEntity extends Entity implements IHosted {
  static readonly TYPE = 'finish';

  readonly type: string = FinishEntity.TYPE;

  materialId: MaterialId | null = null;
  /** bottom of the finished band above the wall base */
  sillHeight = 0;
  /** top of the band; null = up to the wall height (resolved on read) */
  topHeight: number | null = null;
  /** along-wall extent as baseline parameters (0..1) */
  t0 = 0;
  t1 = 1;
  /** nominal build-up thickness — only the m³ unit uses it */
  thickness = DEFAULT_THICKNESS;
  /** created by FINISH.AUTO — replaced on the next regeneration */
  auto = false;

  get hostRef(): RelationId | null {
    return this.doc?.relations.relationOfHosted(this.id)?.id ?? null;
  }

  private host(): WallEntity | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    if (!relation) return null;
    const host = this.doc.get(relation.hostId);
    return host instanceof WallEntity ? host : null;
  }

  /** the wall face segment this finish sits on, from the relation's anchor */
  private faceAnchor(): SegmentShape | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    const host = this.host();
    if (!relation || !host || !isHost(host)) return null;
    const anchor = host.getAnchors()[relation.anchorIndex];
    return anchor && anchor.geometry.kind === 'segment' ? anchor.geometry : null;
  }

  /** 'face+' | 'face-' | null — derived from the relation's anchor name */
  getSide(): string | null {
    if (!this.doc) return null;
    const relation = this.doc.relations.relationOfHosted(this.id);
    const host = this.host();
    if (!relation || !host || !isHost(host)) return null;
    return host.getAnchors()[relation.anchorIndex]?.name ?? null;
  }

  getThickness(): number {
    return this.thickness;
  }

  /** covered length along the wall — the reference length for m materials */
  getCoveredLength(): number {
    const host = this.host();
    if (!host) return 0;
    return Math.max(0, (this.t1 - this.t0) * host.getLength());
  }

  /** finished band area minus overlapping openings (m²) */
  getNetArea(): number {
    const host = this.host();
    if (!host) return 0;
    const length = host.getLength();
    const along0 = this.t0 * length;
    const along1 = this.t1 * length;
    const top = this.topHeight ?? host.getHeight();
    const bandLen = Math.max(0, along1 - along0);
    const bandHeight = Math.max(0, top - this.sillHeight);
    let area = bandLen * bandHeight;
    for (const spec of host.getOpeningSpecs()) {
      const openLen0 = spec.t * length - spec.width / 2;
      const openLen1 = spec.t * length + spec.width / 2;
      const overlapLen = Math.max(0, Math.min(along1, openLen1) - Math.max(along0, openLen0));
      const openTop = spec.sill + spec.height;
      const overlapH = Math.max(0, Math.min(top, openTop) - Math.max(this.sillHeight, spec.sill));
      area -= overlapLen * overlapH;
    }
    return Math.max(0, area);
  }

  /** plan symbol: the covered sub-segment of the wall face */
  getBaseGeometry(): Geometry {
    const face = this.faceAnchor();
    if (!face) return { kind: 'group', children: [] };
    return {
      kind: 'segment',
      a: lerp(face.a, face.b, this.t0),
      b: lerp(face.a, face.b, this.t1),
    };
  }

  evalPlacement(anchor: Anchor, _params: PlacementParams): Placement {
    const seg = anchor.geometry as SegmentShape;
    return { position: lerp(seg.a, seg.b, (this.t0 + this.t1) / 2), rotation: 0 };
  }

  getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[] {
    if (filter && !filter.includes('endpoint')) return [];
    const face = this.faceAnchor();
    if (!face) return [];
    return [
      { kind: 'endpoint', point: lerp(face.a, face.b, this.t0), entityId: this.id },
      { kind: 'endpoint', point: lerp(face.a, face.b, this.t1), entityId: this.id },
    ];
  }

  hitTest(pt: Point, tolerance: number): boolean {
    const face = this.faceAnchor();
    if (!face) return false;
    return (
      distanceToSegment(pt, lerp(face.a, face.b, this.t0), lerp(face.a, face.b, this.t1)) <=
      tolerance
    );
  }

  /** a finish is bound to its wall face — a move is a no-op */
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
    copy.auto = this.auto;
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
      auto: this.auto,
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
      typeof props['materialId'] === 'string' ? (props['materialId'] as MaterialId) : null;
    this.sillHeight = sillHeight;
    this.topHeight = typeof props['topHeight'] === 'number' ? props['topHeight'] : null;
    this.t0 = t0;
    this.t1 = t1;
    this.thickness = thickness;
    this.auto = props['auto'] === true;
  }
}

export function createFinishEntity(id?: EntityId): FinishEntity {
  return new FinishEntity(id);
}
