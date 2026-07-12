import type { OpeningDeduction } from './takeoff.js';
import type { BoqLine } from './boq.js';

/**
 * Measurement rules are POLICY, pluggable by design: how quantities are
 * measured varies by country, standard, and firm. Core computes facts;
 * rules decide what counts. Two hook points cover the classic cases:
 *
 * - `deducts` — should this opening deduction actually deduct? A deduction
 *   applies only if every rule with a `deducts` hook agrees.
 * - `factor` — multiply a finished line's quantity (waste, compaction…).
 *   Factors from all rules multiply together.
 */
export interface MeasurementRule {
  readonly id: string;
  readonly description: string;
  deducts?(deduction: OpeningDeduction): boolean;
  factor?(line: BoqLine): number;
}

/** the classic: openings under `minArea` m² are NOT deducted */
export function smallOpeningRule(minArea = 0.5): MeasurementRule {
  return {
    id: `small-opening-${minArea}`,
    description: `openings under ${minArea} m² are not deducted`,
    deducts: (d) => d.area >= minArea,
  };
}

/** flat waste allowance applied to every line quantity */
export function wasteFactorRule(percent: number): MeasurementRule {
  return {
    id: `waste-${percent}`,
    description: `${percent}% waste allowance on all quantities`,
    factor: () => 1 + percent / 100,
  };
}

/** a sensible default ruleset for demos; real projects load their own */
export function defaultRules(): MeasurementRule[] {
  return [smallOpeningRule(0.5), wasteFactorRule(5)];
}
