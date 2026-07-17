import type { MaterialUnit } from '../document/materials/index.js';

/**
 * The geometric measures one assembly layer can draw from, depending on its
 * material unit. Populated per element: a wall gives its net face area and
 * length, a slab/roof its plan/slope area and perimeter.
 */
export interface LayerRefs {
  /** net solid volume of the element (m³) */
  readonly volume: number;
  /** reference face/plan/slope area (m²) */
  readonly area: number;
  /** linear measure — wall length or slab/roof perimeter (m) */
  readonly length: number;
}

/**
 * Quantity of one assembly layer in its material's own unit — the single
 * source of truth shared by core quantities and the estimator BOQ, so the
 * Materials panel and the Cost panel never disagree:
 *
 * - `m3` — a thickness-proportional share of the element's volume (each
 *   layer's own solid volume).
 * - `m2` — the full reference area (thickness-independent: a 2 mm membrane
 *   is priced by the area it covers, not its sliver of volume).
 * - `m`  — the reference length (edge/linear items: DPC, coping, trim).
 * - `count` — reference area ÷ coverage (tiles from area and tile size;
 *   coverage ≤ 0 or missing falls back to 1 unit per m²).
 */
export function layerQuantity(
  unit: MaterialUnit,
  layerThickness: number,
  totalThickness: number,
  refs: LayerRefs,
  coverage?: number,
): number {
  switch (unit) {
    case 'm2':
      return refs.area;
    case 'm':
      return refs.length;
    case 'count':
      return refs.area / (coverage && coverage > 0 ? coverage : 1);
    case 'm3':
    default:
      return totalThickness > 0 ? refs.volume * (layerThickness / totalThickness) : 0;
  }
}
