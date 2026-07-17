import type { DrawingDocument } from '@acip/editor-core';
import { computeRoofTakeoff, computeSlabTakeoff, computeWallTakeoff } from './takeoff.js';
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

/**
 * Facts → policy → money, in one pass:
 * 1. net volumes — walls: gross − deductions the rules allow; slabs: as-is,
 * 2. split across assembly layers proportional to thickness,
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

  for (const wall of computeWallTakeoff(doc)) {
    let net = wall.grossVolume;
    for (const deduction of wall.deductions) {
      const applies = rules.every((rule) => rule.deducts?.(deduction) ?? true);
      if (applies) net -= deduction.volume;
    }
    net = Math.max(0, net);

    const totalThickness = wall.layers.reduce((sum, layer) => sum + layer.thickness, 0);
    if (totalThickness > 0) {
      for (const layer of wall.layers) {
        accumulate(layer.costCode, layer.name, layer.unit, net * (layer.thickness / totalThickness));
      }
    } else if (net > 0) {
      accumulate(GENERIC_WALL_CODE, 'Wall (no assembly)', 'm3', net);
    }
  }

  for (const slab of computeSlabTakeoff(doc)) {
    const totalThickness = slab.layers.reduce((sum, layer) => sum + layer.thickness, 0);
    if (totalThickness > 0) {
      for (const layer of slab.layers) {
        accumulate(
          layer.costCode,
          layer.name,
          layer.unit,
          slab.volume * (layer.thickness / totalThickness),
        );
      }
    } else if (slab.volume > 0) {
      accumulate(GENERIC_SLAB_CODE, 'Slab (no assembly)', 'm3', slab.volume);
    }
  }

  for (const roof of computeRoofTakeoff(doc)) {
    const totalThickness = roof.layers.reduce((sum, layer) => sum + layer.thickness, 0);
    if (totalThickness > 0) {
      for (const layer of roof.layers) {
        accumulate(
          layer.costCode,
          layer.name,
          layer.unit,
          roof.volume * (layer.thickness / totalThickness),
        );
      }
    } else if (roof.volume > 0) {
      accumulate(GENERIC_ROOF_CODE, 'Roof (no assembly)', 'm3', roof.volume);
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
