import { afterEach, describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Material, MaterialId } from '@acip/editor-core';
import {
  EMPTY_DRAFT,
  NewLayerFields,
  type LayerDraft,
  draftFrom,
  manualLayerFrom,
  toCostCode,
} from '@/app/components/layout/footer/estimator-add-layers';
import { LayerChoices } from '@/app/components/layout/footer/estimator-add-layers';
import {
  DEMO_RATES,
  MANUAL_RATES_KEY,
  currentRates,
  hydrateManualRates,
  priceOf,
  readManualRates,
  resetRates,
  setManualRate,
  writeManualRates,
} from '@/data/rates';

/**
 * A price typed into the add sheet has to survive two journeys: into the live
 * table the sheet prices against, and into the browser so tomorrow's visit
 * still knows it. Both are asserted here, on plain functions, because the
 * whole point of keeping the draft logic and the store out of the components
 * is that neither needs a dialog to be checked.
 */

/** `localStorage` without a browser — and one that can be made to fail */
function fakeStorage(failing = false): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (i: number) => [...map.keys()][i] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => {
      // the real thing throws when it is full or blocked, which is the case
      // worth having a test for
      if (failing) throw new Error('QuotaExceededError');
      map.set(key, value);
    },
  };
}

// the rate table is a module singleton, so a test that leaves a price in it
// prices the next test's layer
afterEach(() => resetRates());

describe('a name as a cost code', () => {
  it('kebab-cases what was typed', () => {
    expect(toCostCode('Gypsum board 12mm')).toBe('gypsum-board-12mm');
  });

  it('folds case, so one word is one key wherever it was typed', () => {
    // the failure this prevents: the same material priced on a phone that
    // capitalises the first letter, and on a desktop that does not
    expect(toCostCode('Paint')).toBe(toCostCode('paint'));
  });

  it('leaves no leading, trailing or doubled separator', () => {
    expect(toCostCode('  Skim / render  ')).toBe('skim-render');
    expect(toCostCode('***')).toBe('');
  });
});

describe('the new-layer draft as something that can be saved', () => {
  const draft = (over: Partial<LayerDraft> = {}): LayerDraft => ({
    ...EMPTY_DRAFT,
    name: 'Gypsum board',
    unitCost: '18.5',
    ...over,
  });

  it('is nothing until it has a name', () => {
    expect(manualLayerFrom(draft({ name: '   ' }))).toBeNull();
  });

  it('is nothing until it has a price', () => {
    // the one that matters: `Number('')` is 0, and 0 is a price. A blank box
    // must not add a layer that says the work is free.
    expect(manualLayerFrom(draft({ unitCost: '' }))).toBeNull();
    expect(manualLayerFrom(draft({ unitCost: '  ' }))).toBeNull();
  });

  it('refuses a price below nothing', () => {
    expect(manualLayerFrom(draft({ unitCost: '-4' }))).toBeNull();
  });

  it('takes zero, because zero is a real price', () => {
    // owner-supplied material, or work already paid for — and the app is built
    // on zero and "nobody has quoted this" being different answers
    expect(manualLayerFrom(draft({ unitCost: '0' }))?.unitCost).toBe(0);
  });

  it('follows the name when no code was typed', () => {
    expect(manualLayerFrom(draft())?.costCode).toBe('gypsum-board');
  });

  it('lets a typed code win, so it can match a table that already exists', () => {
    const layer = manualLayerFrom(draft({ costCode: ' plaster ' }));
    expect(layer?.costCode).toBe('plaster');
  });

  it('is nothing when the name leaves no code behind it', () => {
    // "***" is a name but not a key, and a layer with no cost code could never
    // be looked up in a rate table
    expect(manualLayerFrom(draft({ name: '***', costCode: '' }))).toBeNull();
  });

  it('carries a tile size only where core reads one', () => {
    const counted = manualLayerFrom(draft({ unit: 'count', coverage: '0.09' }));
    expect(counted?.coverage).toBe(0.09);
    // on an m² material coverage is ignored by `layerQuantity`, so it must not
    // travel and pretend otherwise
    const area = manualLayerFrom(draft({ unit: 'm2', coverage: '0.09' }));
    expect(area?.coverage).toBeUndefined();
  });

  it('leaves a blank size to the face the layer lands on', () => {
    const layer = manualLayerFrom(draft({ width: '', height: '' }));
    expect(layer?.width).toBeUndefined();
    expect(layer?.height).toBeUndefined();
  });

  it('carries a default size when one was typed', () => {
    const layer = manualLayerFrom(draft({ width: '3.7', height: '1.2' }));
    expect(layer?.width).toBe(3.7);
    expect(layer?.height).toBe(1.2);
  });

  it('refuses a size of nothing, unlike a price of nothing', () => {
    // zero money is a real answer — owner-supplied, already paid for. Zero
    // metres is not a measurement, it is a band that should not be drawn.
    expect(manualLayerFrom(draft({ width: '0' }))).toBeNull();
    expect(manualLayerFrom(draft({ height: '0' }))).toBeNull();
  });

  it('refuses the whole draft over a size it cannot use', () => {
    // NOT dropped quietly: ignoring it would apply the layer at the face's own
    // size while the user watched themselves measure one
    expect(manualLayerFrom(draft({ width: '-5' }))).toBeNull();
    expect(manualLayerFrom(draft({ height: 'tall' }))).toBeNull();
  });

  it('carries a description, trimmed, and nothing when it is blank', () => {
    expect(
      manualLayerFrom(draft({ description: '  12mm board  ' }))?.description,
    ).toBe('12mm board');
    expect(
      manualLayerFrom(draft({ description: '   ' }))?.description,
    ).toBeUndefined();
  });

  it('still saves a count material with no tile size', () => {
    // core already decides what a missing coverage means — one unit per m² —
    // and that is a real way to buy
    const layer = manualLayerFrom(draft({ unit: 'count', coverage: '' }));
    expect(layer?.unit).toBe('count');
    expect(layer?.coverage).toBeUndefined();
  });
});

describe('the new-layer form', () => {
  const html = (over: Partial<LayerDraft> = {}, currency = 'EUR') =>
    renderToStaticMarkup(
      <NewLayerFields
        draft={{ ...EMPTY_DRAFT, ...over }}
        currency={currency}
        onChange={() => undefined}
      />,
    );

  it('opens measured by area, which is how a finish is nearly always bought', () => {
    expect(EMPTY_DRAFT.unit).toBe('m2');
  });

  it('asks for the price in the table’s own currency, per the chosen unit', () => {
    expect(html({ unit: 'm2' })).toContain('EUR per m2');
    expect(html({ unit: 'count' })).toContain('EUR per unit');
  });

  it('shows the tile size box only for a count material', () => {
    expect(html({ unit: 'count' })).toContain('Size of one unit');
    expect(html({ unit: 'm3' })).not.toContain('Size of one unit');
  });

  it('asks for a default size in the row’s own words', () => {
    // the same two measurements the estimator row shows, so a default reads as
    // the starting value of those rather than a third thing to set
    const shown = html();
    expect(shown).toContain('Default width');
    expect(shown).toContain('Height from ground');
  });

  it('says a blank size means the whole face', () => {
    expect(html()).toContain('placeholder="whole face"');
  });

  it('offers somewhere to say what the figures cannot', () => {
    expect(html()).toContain('Description');
  });

  it('no longer asks for a cost code or a strip-out price', () => {
    // the code follows the name, which is all it did for anyone who never
    // typed over the box; the strip-out is not this form's question
    const shown = html({ name: 'Gypsum board 12mm' });
    expect(shown).not.toContain('Cost code');
    expect(shown).not.toContain('Strip-out');
  });
});

describe('an existing material opened for correction', () => {
  const material = (over: Partial<Material> = {}): Material => ({
    id: 'm1' as MaterialId,
    name: 'Plaster',
    unit: 'm3',
    costCode: 'plaster',
    ...over,
  });

  it('opens on what the material, the table and the defaults already say', () => {
    setManualRate('plaster', { unit: 'm3', unitCost: 310 });
    expect(
      draftFrom(material(), currentRates(), {
        width: 3.7,
        height: 1.2,
        description: '12mm board',
      }),
    ).toEqual({
      name: 'Plaster',
      unit: 'm3',
      costCode: 'plaster',
      coverage: '',
      unitCost: '310',
      width: '3.7',
      height: '1.2',
      description: '12mm board',
    });
  });

  it('opens with an empty price box when nobody has quoted the code', () => {
    // the honest showing of "no rate yet", and directly typeable over
    const draft = draftFrom(material({ costCode: 'gypsum-board' }), {
      currency: 'EUR',
      rates: {},
    });
    expect(draft.unitCost).toBe('');
  });

  it('opens with empty size boxes when no default was ever recorded', () => {
    // blank is the real answer: the layer covers whatever face it lands on
    const draft = draftFrom(material(), currentRates());
    expect(draft.width).toBe('');
    expect(draft.height).toBe('');
    expect(draft.description).toBe('');
  });

  it('writes the cost code out rather than leaving it to follow the name', () => {
    // an existing code is a fact the bill is already using: left blank to be
    // re-derived, fixing a typo in the name would silently re-key the layer
    const draft = draftFrom(
      material({ name: 'Plaster skim', costCode: 'plaster' }),
      currentRates(),
    );
    expect(draft.costCode).toBe('plaster');
    expect(draft.costCode).not.toBe(toCostCode('Plaster skim'));
  });

  it('falls back to the name as the code, exactly as the takeoff does', () => {
    const bare = material({ name: 'Odd stuff', costCode: undefined });
    expect(draftFrom(bare, currentRates()).costCode).toBe('Odd stuff');
  });

  it('carries a tile size back into the box it came from', () => {
    const tile = material({ unit: 'count', coverage: 0.09 });
    expect(draftFrom(tile, currentRates()).coverage).toBe('0.09');
  });

  it('round-trips: what it opens with is what it would save', () => {
    // `draftFrom` is the inverse of `manualLayerFrom`, and a form that changed
    // a layer just by being opened and saved would be the worst kind of edit
    setManualRate('wall-tile', { unit: 'count', unitCost: 2.4 });
    const tile = material({
      name: 'Wall tile',
      unit: 'count',
      costCode: 'wall-tile',
      coverage: 0.09,
    });
    const defaults = { width: 3.7, height: 1.2, description: '300x300' };
    expect(manualLayerFrom(draftFrom(tile, currentRates(), defaults))).toEqual({
      name: 'Wall tile',
      unit: 'count',
      costCode: 'wall-tile',
      coverage: 0.09,
      unitCost: 2.4,
      width: 3.7,
      height: 1.2,
      description: '300x300',
    });
  });
});

describe('reaching the edit sheet from the catalogue', () => {
  const MATERIALS: readonly Material[] = [
    {
      id: 'm1' as MaterialId,
      name: 'Plaster',
      unit: 'm3',
      costCode: 'plaster',
    },
    { id: 'm2' as MaterialId, name: 'Paint', unit: 'm2', costCode: 'paint' },
  ];

  const html = (alreadyIn: ReadonlySet<string> = new Set()) =>
    renderToStaticMarkup(
      <LayerChoices
        materials={MATERIALS}
        query=""
        picked={new Set()}
        alreadyIn={alreadyIn}
        onPick={() => undefined}
        onEdit={() => undefined}
      />,
    );

  it('offers every row for editing, by name', () => {
    const shown = html();
    expect(shown).toContain('Edit Plaster');
    expect(shown).toContain('Edit Paint');
  });

  it('still offers a row that is already on this side', () => {
    // the tick is disabled there, and a button inside the label would have gone
    // with it — which is the row whose price somebody most wants to correct
    expect(html(new Set(['m1']))).toContain('Edit Plaster');
  });

  it('keeps the edit control out of the tick’s own hit area', () => {
    // nested in the checkbox label, editing a material would tick it on the way
    const shown = html();
    expect(shown.indexOf('Edit Plaster')).toBeGreaterThan(
      shown.indexOf('Plaster'),
    );
    expect(shown).toContain('aria-label="Edit Plaster"');
  });
});

describe('a hand-typed rate reaching the table the sheet prices against', () => {
  it('prices a code the shipped table has never heard of', () => {
    const code = 'gypsum-board';
    // the state this feature exists to fix
    expect(priceOf(currentRates(), code, 10)).toBeNull();
    setManualRate(code, { unit: 'm2', unitCost: 18.5 });
    expect(priceOf(currentRates(), code, 10)?.amount).toBeCloseTo(185, 6);
  });

  it('beats the shipped figure for a code that already had one', () => {
    // somebody who has just typed what paint costs on this job has said so,
    // and a placeholder quietly outranking them is indefensible
    expect(DEMO_RATES.rates['paint']?.unitCost).toBe(12);
    setManualRate('paint', { unit: 'm2', unitCost: 20 });
    expect(currentRates().rates['paint']?.unitCost).toBe(20);
  });

  it('leaves the shipped table itself alone', () => {
    setManualRate('paint', { unit: 'm2', unitCost: 20 });
    // DEMO_RATES is the seed the desktop editor and the tests share; the store
    // is what moves
    expect(DEMO_RATES.rates['paint']?.unitCost).toBe(12);
  });

  it('refuses a rate it could not price with', () => {
    setManualRate('junk', { unit: 'm2', unitCost: Number.NaN });
    setManualRate('', { unit: 'm2', unitCost: 5 });
    expect(currentRates().rates['junk']).toBeUndefined();
    expect(currentRates().rates['']).toBeUndefined();
  });

  it('keeps the price for the next visit', () => {
    const store = fakeStorage();
    setManualRate('gypsum-board', { unit: 'm2', unitCost: 18.5 }, store);
    expect(readManualRates(store)['gypsum-board']).toEqual({
      unit: 'm2',
      unitCost: 18.5,
    });
  });

  it('still applies a price it could not keep', () => {
    // private mode, a full quota, a locked-down browser: the rate is no less
    // real for not being storable, and the sheet must not fall over
    const store = fakeStorage(true);
    expect(
      setManualRate('gypsum-board', { unit: 'm2', unitCost: 18.5 }, store),
    ).toBe(false);
    expect(currentRates().rates['gypsum-board']?.unitCost).toBe(18.5);
  });
});

describe('what this device typed, on the next visit', () => {
  it('merges over the shipped table and wins where they collide', () => {
    const store = fakeStorage();
    writeManualRates(store, {
      'gypsum-board': { unit: 'm2', unitCost: 18.5 },
      paint: { unit: 'm2', unitCost: 20 },
    });
    hydrateManualRates(store);
    const table = currentRates();
    expect(table.rates['gypsum-board']?.unitCost).toBe(18.5);
    expect(table.rates['paint']?.unitCost).toBe(20);
    // and the rest of the shipped table is still there
    expect(table.rates['block']?.unitCost).toBe(120);
  });

  it('treats an unreadable key as nothing rather than throwing', () => {
    // a browser store the user also clears: a corrupt key must not be able to
    // stop the editor opening
    const store = fakeStorage();
    store.setItem(MANUAL_RATES_KEY, 'not json at all');
    expect(readManualRates(store)).toEqual({});
    expect(() => hydrateManualRates(store)).not.toThrow();
  });

  it('drops the rows inside it that are not rates', () => {
    const store = fakeStorage();
    store.setItem(
      MANUAL_RATES_KEY,
      JSON.stringify({
        good: { unit: 'm2', unitCost: 7 },
        'bad-unit': { unit: 'furlong', unitCost: 7 },
        'bad-cost': { unit: 'm2', unitCost: 'seven' },
        negative: { unit: 'm2', unitCost: -1 },
      }),
    );
    // a string where a number belongs would not throw, it would show NaN on a
    // bill — so it is refused at the door
    expect(Object.keys(readManualRates(store))).toEqual(['good']);
  });
});
