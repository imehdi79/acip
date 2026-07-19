import type { RateTable } from '@acip/estimator';
import { ValueStore } from './store';

/** demo rate table for the seeded catalog — real projects load their own data */
export const DEMO_RATES: RateTable = {
  currency: 'EUR',
  rates: {
    block: { unit: 'm3', unitCost: 120 },
    insulation: { unit: 'm3', unitCost: 85 },
    plaster: { unit: 'm3', unitCost: 310 },
    'wall-volume': { unit: 'm3', unitCost: 150 },
    'concrete-slab': { unit: 'm3', unitCost: 95 },
    screed: { unit: 'm3', unitCost: 180 },
    'slab-volume': { unit: 'm3', unitCost: 110 },
    'roof-structure': { unit: 'm3', unitCost: 140 },
    roofing: { unit: 'm3', unitCost: 260 },
    'roof-volume': { unit: 'm3', unitCost: 160 },
    'wall-tile': { unit: 'count', unitCost: 2.4 },
    'floor-tile': { unit: 'm2', unitCost: 32 },
    'finish-area': { unit: 'm2', unitCost: 25 },
    stair: { unit: 'count', unitCost: 1500 },
  },
};

/**
 * The live rate table: starts as demo data, replaced by the office's
 * published rates from editor-server once they exist. Cost panels subscribe,
 * so a publish on the admin page reprices open editors on next load.
 */
export const ratesStore = new ValueStore<RateTable>(DEMO_RATES);

/** merge published rates over the demo table; demo fills the gaps */
export async function loadServerRates(serverUrl: string): Promise<void> {
  try {
    const response = await fetch(`${serverUrl}/api/rates/table`);
    if (!response.ok) return;
    const table = (await response.json()) as RateTable;
    if (!table || Object.keys(table.rates ?? {}).length === 0) return;
    ratesStore.set({
      currency: table.currency || DEMO_RATES.currency,
      rates: { ...DEMO_RATES.rates, ...table.rates },
    });
  } catch {
    // offline or no server — demo rates remain
  }
}
