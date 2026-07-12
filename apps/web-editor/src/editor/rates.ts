import type { RateTable } from '@acip/estimator';

/** demo rate table for the seeded catalog — real projects load their own data */
export const DEMO_RATES: RateTable = {
  currency: 'EUR',
  rates: {
    block: { unit: 'm3', unitCost: 120 },
    insulation: { unit: 'm3', unitCost: 85 },
    plaster: { unit: 'm3', unitCost: 310 },
    'wall-volume': { unit: 'm3', unitCost: 150 },
  },
};
