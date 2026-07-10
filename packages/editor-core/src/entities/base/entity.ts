import { newEntityId } from '../../common/id.js';
import type { EntityId, LayerId, TypeId } from '../../common/id.js';
import type { JsonObject } from '../../common/json.js';
import { DocumentError } from '../../common/errors.js';
import type { Point } from '../../geometry/primitives/point.js';
import type { Matrix3 } from '../../geometry/primitives/matrix3.js';
import type { BBox } from '../../geometry/primitives/bbox.js';
import type { Geometry } from '../../geometry/shapes.js';
import { geometryBBox } from '../../geometry/shapes.js';
import type { SnapKind, SnapPoint } from './snap.js';
import type { EntityData } from './data.js';
import type { DrawingDocument } from '../../document/document.js';
import type { Transaction } from '../../document/history/transaction.js';
import { DEFAULT_LAYER_ID } from '../../document/layer.js';

export abstract class Entity {
  readonly id: EntityId;
  abstract readonly type: string;
  layerId: LayerId = DEFAULT_LAYER_ID;
  typeRef?: TypeId;

  protected readonly dataVersion: number = 1;

  private _doc: DrawingDocument | null = null;

  constructor(id?: EntityId) {
    this.id = id ?? newEntityId();
  }

  /** null while detached; definition methods work detached, derived methods don't */
  get doc(): DrawingDocument | null {
    return this._doc;
  }

  protected requireDoc(): DrawingDocument {
    if (!this._doc) {
      throw new DocumentError(`entity ${this.id} (${this.type}) is not in a document`);
    }
    return this._doc;
  }

  /** @internal called only by DrawingDocument */
  _attachToDocument(doc: DrawingDocument): void {
    this._doc = doc;
  }

  /** @internal called only by DrawingDocument */
  _detachFromDocument(): void {
    this._doc = null;
  }

  /** definition geometry from own data only — works detached */
  abstract getBaseGeometry(): Geometry;

  /** after relations have their say (e.g. wall minus openings) — may require doc */
  getEffectiveGeometry(): Geometry {
    return this.getBaseGeometry();
  }

  getBounds(): BBox {
    return geometryBBox(this.getEffectiveGeometry());
  }

  abstract getSnapPoints(filter?: readonly SnapKind[]): SnapPoint[];

  abstract hitTest(pt: Point, tolerance: number): boolean;

  /** mutations must be registered on the transaction (tx.update) */
  abstract transform(m: Matrix3, tx: Transaction): void;

  /** copy with a NEW id */
  abstract clone(): Entity;

  saveData(): EntityData {
    const data: {
      id: string;
      type: string;
      layerId: string;
      version: number;
      props: JsonObject;
      typeRef?: string;
    } = {
      id: this.id,
      type: this.type,
      layerId: this.layerId,
      version: this.dataVersion,
      props: this.saveProps(),
    };
    if (this.typeRef !== undefined) data.typeRef = this.typeRef;
    return data;
  }

  loadData(data: EntityData): void {
    this.layerId = data.layerId as LayerId;
    this.typeRef = data.typeRef as TypeId | undefined;
    this.loadProps(data.props, data.version);
  }

  protected abstract saveProps(): JsonObject;
  protected abstract loadProps(props: JsonObject, version: number): void;
}
