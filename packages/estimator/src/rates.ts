/**
 * Rates are DATA, never code: cost figures are volatile and regional. A rate
 * table is plain JSON keyed by cost code (Material.costCode, falling back to
 * the material name).
 */
export interface Rate {
  readonly unit: string;
  readonly unitCost: number;
}

export interface RateTable {
  readonly currency: string;
  readonly rates: Readonly<Record<string, Rate>>;
}
