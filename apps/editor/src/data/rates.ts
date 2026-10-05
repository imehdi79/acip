import type { Rate, RateTable } from '@acip/estimator';
import { ValueStore } from '@/editor/store';
import { pushStore } from './sync';

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

/** where rates typed into this app are kept between visits */
export const MANUAL_RATES_KEY = 'acip.rates.manual.v1';

/** the rates this device has typed, keyed by cost code */
export type ManualRates = Readonly<Record<string, Rate>>;

const UNITS: readonly string[] = ['m3', 'm2', 'm', 'count'];

/**
 * Is this a rate, or something a corrupt key left behind?
 *
 * Checked field by field rather than trusted, because the table this feeds is
 * what the sheet multiplies quantities by: a string where `unitCost` should be
 * would not throw, it would quietly show `NaN EUR` on a bill.
 *
 * Zero passes. Zero is a real price — owner-supplied material, work already
 * paid for — and the whole argument in `priceOf` is that zero and "nobody has
 * quoted this" are different answers, which means zero has to be sayable.
 */
function isRate(value: unknown): value is Rate {
  if (!value || typeof value !== 'object') return false;
  const raw = value as Record<string, unknown>;
  const cost = raw['unitCost'];
  return (
    typeof raw['unit'] === 'string' &&
    UNITS.includes(raw['unit']) &&
    typeof cost === 'number' &&
    Number.isFinite(cost) &&
    cost >= 0
  );
}

/**
 * Everything this device has priced by hand.
 *
 * Unreadable is treated as empty rather than thrown, for the same reason
 * `readProjects` does it: this is a browser store the user also clears, and a
 * corrupt key must not be able to stop the editor opening. The cost of being
 * wrong here is a price to type again; the cost of throwing is an app that
 * will not start.
 */
export function readManualRates(store: Storage): ManualRates {
  try {
    const raw = store.getItem(MANUAL_RATES_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
      return {};
    const rates: Record<string, Rate> = {};
    for (const [code, rate] of Object.entries(
      parsed as Record<string, unknown>,
    )) {
      if (code && isRate(rate)) rates[code] = rate;
    }
    return rates;
  } catch {
    return {};
  }
}

/**
 * Keep them, or carry on without them.
 *
 * `localStorage` fails by THROWING when it is full or blocked (private mode,
 * a locked-down browser), and a price that could not be saved is still a price
 * worth showing for this visit. So the failure is reported rather than raised:
 * the caller has already put the rate in the live table, and this only decides
 * whether it is still there tomorrow.
 */
export function writeManualRates(store: Storage, rates: ManualRates): boolean {
  try {
    store.setItem(MANUAL_RATES_KEY, JSON.stringify(rates));
    return true;
  } catch {
    return false;
  }
}

/**
 * The table the sheet actually prices against, live.
 *
 * `DEMO_RATES` is the SEED and stays exactly what it was — a frozen constant
 * that the tests and the desktop editor share. What changes is that the app no
 * longer reads it directly: a rate typed into the add sheet has to land
 * somewhere between the module and the render, and this is that somewhere.
 *
 * It is also the seam the office's published table arrives through when
 * editor-server is wired up here (web-editor already does exactly this in its
 * own `loadServerRates`) — so the manual rate and the published one will merge
 * in one place rather than two.
 */
export const ratesStore = new ValueStore<RateTable>(DEMO_RATES);

/** what to price against right now — read at the moment of pricing, never cached */
export function currentRates(): RateTable {
  return ratesStore.get();
}

/**
 * Put one hand-typed rate in the live table and keep it.
 *
 * Manual WINS over the demo figure for the same code. Someone who has just
 * typed a price for `paint` has said what paint costs on this job, and a
 * shipped placeholder quietly outranking them would be the one behaviour
 * nobody could explain.
 *
 * The store is optional so this is callable from a test with no DOM; the sheet
 * passes `window.localStorage`. Returns whether it was persisted, which is not
 * the same as whether it was applied — it is always applied.
 */
export function setManualRate(
  costCode: string,
  rate: Rate,
  store?: Storage,
): boolean {
  const code = costCode.trim();
  if (!code || !isRate(rate)) return false;
  const table = ratesStore.get();
  ratesStore.set({
    currency: table.currency,
    rates: { ...table.rates, [code]: rate },
  });
  if (!store) return false;
  const manual = { ...readManualRates(store), [code]: rate };
  const kept = writeManualRates(store, manual);
  // the office's own table, as this device has it — see sync.pushStore for why
  // the whole blob goes rather than the one code that changed
  pushStore(store, MANUAL_RATES_KEY, manual);
  return kept;
}

/** merge what this device typed over the demo table, once, at start-up */
export function hydrateManualRates(store: Storage): void {
  const manual = readManualRates(store);
  if (Object.keys(manual).length === 0) return;
  ratesStore.set({
    currency: DEMO_RATES.currency,
    rates: { ...DEMO_RATES.rates, ...manual },
  });
}

/** back to the shipped table — for tests, which share one module instance */
export function resetRates(): void {
  ratesStore.set(DEMO_RATES);
}

/**
 * The rates a drawing needs, lifted out of the live table.
 *
 * Only the codes the drawing actually uses. A whole-table copy would make
 * every saved plan a snapshot of every price this device has ever typed, and
 * reopening one would drag codes it never referenced back over the table.
 *
 * Taken from the EFFECTIVE table, not from the manual one, so a plan priced
 * against a shipped demo figure saves that figure too. The point of a snapshot
 * is that the estimate reproduces — where the number originally came from is
 * not something the saved plan should still depend on.
 */
export function snapshotRates(
  costCodes: Iterable<string>,
): Record<string, Rate> {
  const table = ratesStore.get();
  const snapshot: Record<string, Rate> = {};
  for (const code of costCodes) {
    const rate = table.rates[code];
    if (rate) snapshot[code] = rate;
  }
  return snapshot;
}

/**
 * Price the editor the way one saved plan was priced.
 *
 * Rebuilt from the bottom rather than merged into what is already showing:
 * shipped demo figures, then what this device has typed, then the plan's own
 * snapshot on top. Opening plan B must not leave plan A's prices behind, and
 * merging over the live table is exactly how it would.
 *
 * The snapshot WINS over the device table, which is the whole point. A bill
 * quoted in March is still a March bill in June, whatever paint has done since
 * — and a rate typed for one job was never a correction to another.
 */
export function applyProjectRates(
  snapshot: Readonly<Record<string, Rate>>,
  store?: Storage,
): void {
  const manual = store ? readManualRates(store) : {};
  ratesStore.set({
    currency: DEMO_RATES.currency,
    rates: { ...DEMO_RATES.rates, ...manual, ...snapshot },
  });
}
