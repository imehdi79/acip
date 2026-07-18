import type { MaterialId } from '../common/id.js';
import {
  add,
  lerp,
  normalize,
  perpendicular,
  scale,
  sub,
} from '../geometry/primitives/point.js';
import type { RegionShape, SegmentShape } from '../geometry/shapes.js';
import type { DrawingDocument } from '../document/document.js';
import { WallEntity } from '../entities/architecture/wall-entity.js';

export interface AssemblyStrip {
  readonly materialId: MaterialId;
  readonly thickness: number;
  /** one plan quad per solid span (openings already subtracted) */
  readonly regions: readonly RegionShape[];
}

export interface WallAssemblyStrips {
  /** outermost first, matching the type catalog's layer order */
  readonly strips: readonly AssemblyStrip[];
  /** boundary lines between adjacent layers, one per interior offset per span */
  readonly separators: readonly SegmentShape[];
}

/**
 * Per-layer plan strips for a wall's type-catalog assembly — display
 * derivation only, never stored. Layers are outermost first; the outermost
 * layer sits on the `face+` side (+normal of the a→b baseline).
 *
 * V1 limitation: strips are plain span quads without junction miters, so at
 * corners the layer boundaries stop at the baseline endpoints instead of
 * folding around the join (see wall-joins.md).
 */
export function wallAssemblyStrips(
  doc: DrawingDocument,
  wall: WallEntity,
): WallAssemblyStrips | null {
  const def = wall.typeRef ? doc.types.get(wall.typeRef) : undefined;
  const layers = def?.layers;
  if (!layers || layers.length === 0) return null;
  const { a, b } = wall.getBaseline();
  const len = wall.getLength();
  if (len <= 0) return null;
  const spans = wall.getSolidSpans();
  if (spans.length === 0) return null;

  const n = perpendicular(normalize(sub(b, a)));
  const total = layers.reduce((sum, layer) => sum + layer.thickness, 0);
  const at = (s: number, offset: number) =>
    add(lerp(a, b, s / len), scale(n, offset));

  const strips: AssemblyStrip[] = [];
  const separators: SegmentShape[] = [];
  let outer = total / 2;
  for (let i = 0; i < layers.length; i++) {
    const inner = outer - layers[i].thickness;
    strips.push({
      materialId: layers[i].materialId,
      thickness: layers[i].thickness,
      regions: spans.map((span) => ({
        kind: 'region',
        boundary: [
          at(span.start, outer),
          at(span.end, outer),
          at(span.end, inner),
          at(span.start, inner),
        ],
        holes: [],
      })),
    });
    if (i < layers.length - 1) {
      for (const span of spans) {
        separators.push({
          kind: 'segment',
          a: at(span.start, inner),
          b: at(span.end, inner),
        });
      }
    }
    outer = inner;
  }
  return { strips, separators };
}
