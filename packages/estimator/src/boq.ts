import type { DrawingDocument, LayerRefs } from '@acip/editor-core';
import { layerQuantity } from '@acip/editor-core';
import type { AssemblyLayerFact } from './takeoff.js';
import {
  computeFinishTakeoff,
  computeRoofTakeoff,
  computeSlabTakeoff,
  computeStairTakeoff,
  computeWallTakeoff,
} from './takeoff.js';
import type { MeasurementRule } from './rules.js';
import type { RateTable } from './rates.js';

export interface BoqLine {
  readonly costCode: string;
  readonly description: string;
  readonly unit: string;
  readonly quantity: number;
  /** null when the rate table has no entry for the cost code */
  readonly rate: number | null;
  readonly amount: number | null;
}

export interface Boq {
  readonly lines: readonly BoqLine[];
  readonly currency: string | null;
  /** sum of priced lines */
  readonly total: number;
  /** cost codes that had quantities but no rate */
  readonly missingRates: readonly string[];
}

export interface BoqOptions {
  readonly rules?: readonly MeasurementRule[];
  readonly rates?: RateTable | null;
}

const GENERIC_WALL_CODE = 'wall-volume';
const GENERIC_SLAB_CODE = 'slab-volume';
const GENERIC_ROOF_CODE = 'roof-volume';
const GENERIC_FINISH_CODE = 'finish-area';

/**
 * Facts → policy → money, in one pass:
 * 1. net measures — walls: gross − deductions the rules allow; slabs/roofs
 *    as-is,
 * 2. split across assembly layers, each in its material's own unit (volume
 *    for m³, area for m², length for m, count for tiles),
 * 3. aggregate by cost code, apply factor rules (waste),
 * 4. price against the rate table.
 */
export function assembleBoq(doc: DrawingDocument, options: BoqOptions = {}): Boq {
  const rules = options.rules ?? [];
  const rates = options.rates ?? null;

  const byCode = new Map<string, { description: string; unit: string; quantity: number }>();
  const accumulate = (code: string, description: string, unit: string, quantity: number) => {
    const entry = byCode.get(code);
    if (entry) entry.quantity += quantity;
    else byCode.set(code, { description, unit, quantity });
  };

  // one element's layers, each measured in its material unit; untyped
  // elements fall back to a generic volume line
  const accumulateLayers = (
    layers: readonly AssemblyLayerFact[],
    refs: LayerRefs,
    genericCode: string,
    genericDesc: string,
  ) => {
    const total = layers.reduce((sum, layer) => sum + layer.thickness, 0);
    if (total > 0) {
      for (const layer of layers) {
        const quantity = layerQuantity(layer.unit, layer.thickness, total, refs, layer.coverage);
        accumulate(layer.costCode, layer.name, layer.unit, quantity);
      }
    } else if (refs.volume > 0) {
      accumulate(genericCode, genericDesc, 'm3', refs.volume);
    }
  };

  for (const wall of computeWallTakeoff(doc)) {
    let netVolume = wall.grossVolume;
    let netFaceArea = wall.length * wall.height;
    for (const deduction of wall.deductions) {
      const applies = rules.every((rule) => rule.deducts?.(deduction) ?? true);
      if (applies) {
        netVolume -= deduction.volume;
        netFaceArea -= deduction.area;
      }
    }
    accumulateLayers(
      wall.layers,
      { volume: Math.max(0, netVolume), area: Math.max(0, netFaceArea), length: wall.length },
      GENERIC_WALL_CODE,
      'Wall (no assembly)',
    );
  }

  for (const slab of computeSlabTakeoff(doc)) {
    accumulateLayers(
      slab.layers,
      { volume: slab.volume, area: slab.area, length: slab.perimeter },
      GENERIC_SLAB_CODE,
      'Slab (no assembly)',
    );
  }

  for (const roof of computeRoofTakeoff(doc)) {
    accumulateLayers(
      roof.layers,
      { volume: roof.volume, area: roof.slopeArea, length: roof.perimeter },
      GENERIC_ROOF_CODE,
      'Roof (no assembly)',
    );
  }

  // a stair is a fabricated item — one unit per flight (per-riser / by-material
  // stair costing is deferred)
  for (const stair of computeStairTakeoff(doc)) {
    if (stair.riserCount > 0) accumulate('stair', 'Stair (flight)', 'count', 1);
  }

  for (const finish of computeFinishTakeoff(doc)) {
    const refs: LayerRefs = {
      volume: finish.area * finish.thickness,
      area: finish.area,
      length: finish.length,
    };
    if (finish.layer) {
      const quantity = layerQuantity(
        finish.layer.unit,
        finish.thickness,
        finish.thickness,
        refs,
        finish.layer.coverage,
      );
      accumulate(finish.layer.costCode, finish.layer.name, finish.layer.unit, quantity);
    } else if (finish.area > 0) {
      accumulate(GENERIC_FINISH_CODE, 'Finish (no material)', 'm2', finish.area);
    }
  }

  const lines: BoqLine[] = [];
  const missingRates: string[] = [];
  let total = 0;
  for (const [costCode, entry] of byCode) {
    let line: BoqLine = {
      costCode,
      description: entry.description,
      unit: entry.unit,
      quantity: entry.quantity,
      rate: null,
      amount: null,
    };
    let quantity = entry.quantity;
    for (const rule of rules) {
      if (rule.factor) quantity *= rule.factor(line);
    }
    const rate = rates?.rates[costCode] ?? null;
    const amount = rate ? quantity * rate.unitCost : null;
    line = { ...line, quantity, rate: rate?.unitCost ?? null, amount };
    if (rate === null) missingRates.push(costCode);
    else total += amount ?? 0;
    lines.push(line);
  }
  lines.sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0) || b.quantity - a.quantity);

  return { lines, currency: rates?.currency ?? null, total, missingRates };
}
