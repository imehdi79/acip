import type { RateTable } from '@acip/estimator';

/**
 * What things cost, keyed by the cost code a material carries.
 *
 * Rates are DATA and never code — cost figures are volatile and regional, and
 * a real project loads its office's own published table. These are the same
 * demo figures the desktop editor ships, in the same currency, against the
 * same codes: a wall priced on a phone and the same wall priced on a desktop
 * must not come out differently because two apps guessed separately.
 *
 * The `demo-` codes are the "demolition is a finish in reverse" convention —
 * a strip-out is priced independently of supply and install, because tearing
 * tile off a wall costs a fraction of laying it and has nothing to do with
 * what the tile was worth.
 *
 * Deliberately incomplete. Nothing here prices `demo-block` or `demo-screed`,
 * and that is left alone rather than filled in with a plausible number: a
 * missing rate is a real answer that the sheet shows as "no rate yet", and
 * inventing one would be putting a figure in a bill that nobody quoted.
 */
export const DEMO_RATES: RateTable = {
  currency: 'EUR',
  rates: {
    block: { unit: 'm3', unitCost: 120 },
    insulation: { unit: 'm3', unitCost: 85 },
    plaster: { unit: 'm3', unitCost: 310 },
    paint: { unit: 'm2', unitCost: 12 },
    'concrete-slab': { unit: 'm3', unitCost: 95 },
    screed: { unit: 'm3', unitCost: 180 },
    'wall-tile': { unit: 'count', unitCost: 2.4 },
    'floor-tile': { unit: 'm2', unitCost: 32 },
    'roof-structure': { unit: 'm3', unitCost: 140 },
    roofing: { unit: 'm3', unitCost: 260 },
    'finish-area': { unit: 'm2', unitCost: 25 },
    // strip-out, priced independently of supply and install
    'demo-wall-tile': { unit: 'm2', unitCost: 9 },
    'demo-floor-tile': { unit: 'm2', unitCost: 8 },
    'demo-plaster': { unit: 'm2', unitCost: 6 },
    'demo-paint': { unit: 'm2', unitCost: 4 },
    'demo-finish': { unit: 'm2', unitCost: 6 },
    'demo-window': { unit: 'count', unitCost: 25 },
    'demo-door': { unit: 'count', unitCost: 20 },
  },
};

/** what one quantity comes to, or null when nobody has quoted this code */
export interface Priced {
  readonly rate: number;
  readonly amount: number;
}

/**
 * Price a quantity against the table.
 *
 * Null rather than zero for a code with no rate. Zero is a price — it says
 * "this costs nothing" — and a bill that quietly totals unquoted work at
 * nothing is the single most expensive kind of wrong an estimate can be. The
 * sheet says "no rate yet" instead, which is what the BOQ's own
 * `missingRates` list has always meant.
 */
export function priceOf(
  table: RateTable,
  costCode: string,
  quantity: number,
): Priced | null {
  const rate = table.rates[costCode];
  if (!rate) return null;
  return { rate: rate.unitCost, amount: rate.unitCost * quantity };
}

/**
 * The cost code a strip-out is billed against: `wall-tile` → `demo-wall-tile`.
 *
 * Core's BOQ builds the same string in `boq.ts`, and this mirrors it for the
 * same reason `anchorForSide` mirrors its own original — so the number the
 * sheet shows and the line the bill carries are looked up by one key.
 */
export function demoCodeFor(costCode: string | null): string {
  return costCode ? `demo-${costCode}` : 'demo-finish';
}

/** money as it is read out loud: two decimals, with the table's own currency */
export function formatMoney(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}
