import type { MaterialId } from '../common/id.js';
import { add, scale } from '../geometry/primitives/point.js';
import type { RegionShape, SegmentShape } from '../geometry/shapes.js';
import type { Interval } from '../topology/intervals.js';
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
  const len = wall.getLength();
  if (len <= 0) return null;
  const spans = wall.getSolidSpans();
  if (spans.length === 0) return null;

  const total = layers.reduce((sum, layer) => sum + layer.thickness, 0);
  /*
   * Offsets are taken from the wall's own FRAMES rather than from its chord,
   * so the layers follow it when it bows. A straight wall hands back its two
   * ends and the strip is the same quad it always was; a curved one hands back
   * as many as its curvature asks for, and the strip curves with the wall
   * instead of cutting across the inside of the bend.
   */
  const along = (span: Interval, offset: number) =>
    wall
      .getFrames(span.start, span.end)
      .map((f) => add(f.point, scale(f.normal, offset)));
  const band = (span: Interval, outer: number, inner: number): RegionShape => ({
    kind: 'region',
    boundary: [...along(span, outer), ...along(span, inner).reverse()],
    holes: [],
  });

  const strips: AssemblyStrip[] = [];
  const separators: SegmentShape[] = [];
  let outer = total / 2;
  for (let i = 0; i < layers.length; i++) {
    const inner = outer - layers[i].thickness;
    strips.push({
      materialId: layers[i].materialId,
      thickness: layers[i].thickness,
      regions: spans.map((span) => band(span, outer, inner)),
    });
    if (i < layers.length - 1) {
      for (const span of spans) {
        // the separator is the layer boundary itself: a line on a straight
        // wall, the same run of points on a curved one
        const line = along(span, inner);
        for (let k = 1; k < line.length; k++) {
          separators.push({ kind: 'segment', a: line[k - 1], b: line[k] });
        }
      }
    }
    outer = inner;
  }
  return { strips, separators };
}
