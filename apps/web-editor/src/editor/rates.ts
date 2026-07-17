import type { RateTable } from '@acip/estimator';

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
  },
};
