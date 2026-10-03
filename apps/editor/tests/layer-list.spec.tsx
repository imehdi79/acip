import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityId, Material, MaterialId } from '@acip/editor-core';
import type { FinishRow } from '@/app/components/layout/footer/estimator-finishes';
import {
  LayerList,
  defaultSide,
  finishFacts,
  formatQuantity,
  layerTotal,
  rowKey,
  sidesFor,
} from '@/app/components/layout/footer/estimator-layers';
import { FinishFields } from '@/app/components/layout/footer/estimator-fields';
import type { OpeningRow } from '@/app/components/layout/footer/estimator-openings';
import {
  coverBounds,
  coverPatch,
} from '@/app/components/layout/footer/estimator-finishes';
import { DEMO_RATES, demoCodeFor, priceOf } from '@/data/rates';
import {
  LayerChoices,
  codeOf,
  materialNote,
  matchesQuery,
} from '@/app/components/layout/footer/estimator-add-layers';
import {
  CLEAR_FRACTION,
  SHEET_MAX_HEIGHT,
} from '@/app/components/layout/footer/estimator';

/**
 * The list is a view onto the document now, so what it renders is handed in as
 * resolved rows rather than fetched. Everything here is the PRESENTATION: what
 * a row says, which side it lands on, and what the sheet does for a shape that
 * cannot carry a build-up at all. Whether those rows are the right rows is
 * `estimator-finishes.spec.ts`, against a real drawing.
 *
 * <LayerList/> and <LayerChoices/> are controlled precisely so this can exist:
 * there is no DOM to tap in, so the states are props and the markup is read.
 */

const row = (over: Partial<FinishRow> = {}): FinishRow => ({
  id: 'f1' as EntityId,
  materialId: 'm1',
  name: 'Plaster',
  unit: 'm2',
  costCode: 'plaster',
  area: 12.4,
  length: 6,
  quantity: 12.4,
  phase: 'new',
  unpriced: false,
  thickness: 0.01,
  deductOpenings: true,
  priced: { rate: 12, amount: 148.8 },
  // nothing stripped yet: the figures echo the build layer's own extent, which
  // is the honest starting guess for what is about to be re-covered
  demolition: {
    width: 6,
    height: 3,
    id: null,
    on: false,
    costCode: 'demo-plaster',
    quantity: 0,
    priced: null,
  },
  // a wall face by default, since that is the host that argues about openings;
  // the floor cases override host to 'slab'
  cover: {
    width: 6,
    height: 3,
    host: 'wall',
    t0: 0,
    sillHeight: 0,
    hostLength: 6,
    hostHeight: 3,
  },
  ...over,
});

const PLASTER = row();
const PAINT = row({
  id: 'f2' as EntityId,
  materialId: 'm2',
  name: 'Paint',
  costCode: 'paint',
});
const TILE = row({
  id: 'f3' as EntityId,
  materialId: 'm3',
  name: 'Wall tile',
  costCode: 'wall-tile',
  unit: 'count',
  quantity: 137.8,
});

const material = (over: Partial<Material> = {}): Material => ({
  id: 'm1' as MaterialId,
  name: 'Plaster',
  unit: 'm3',
  costCode: 'plaster',
  ...over,
});

const NOTHING = new Set<string>();
const noop = () => undefined;

function list({
  kind = 'wall',
  side = 'a',
  rows = {} as Readonly<Record<string, readonly FinishRow[]>>,
  opened = NOTHING as ReadonlySet<string>,
  blocked = undefined as string | undefined,
} = {}) {
  return renderToStaticMarkup(
    <LayerList
      kind={kind}
      side={side}
      rows={rows}
      opened={opened}
      blocked={blocked}
      onSideChange={noop}
      onToggleDetail={noop}
      onRemove={noop}
      onEdit={noop}
      onDeduct={noop}
      openings={[]}
      onDemolish={noop}
      onDemolishToggle={noop}
      onDemolishOpening={noop}
    />,
  );
}

describe('which sides a shape has', () => {
  it('gives a room its floor and its ceiling', () => {
    // a room used to get one tab-less list. That was wrong in the way that
    // matters to a bill: a floor build-up and a ceiling build-up are different
    // trades against different surfaces of the same slab, and one list left
    // the ceiling unreachable
    expect(sidesFor('room').map((s) => s.id)).toEqual(['floor', 'ceiling']);
  });

  it('gives a wall its two faces', () => {
    for (const kind of ['wall', 'door', 'window', 'not-a-thing']) {
      expect(sidesFor(kind).map((s) => s.id)).toEqual(['a', 'b']);
    }
  });

  it('opens each kind on a tab it actually has', () => {
    // the fallback used to be a hard-coded 'a', which a room does not have —
    // it would have selected a tab that was not in its own tab list
    expect(defaultSide('wall')).toBe('a');
    expect(defaultSide('room')).toBe('floor');
    for (const kind of ['wall', 'room', 'window']) {
      expect(sidesFor(kind).map((s) => s.id)).toContain(defaultSide(kind));
    }
  });
});

describe('the layer list', () => {
  it('is empty to start with, and says what to do about it', () => {
    const html = list();
    expect(html).toContain('Nothing here yet');
    expect(html).not.toContain('<ol');
  });

  it('gives a two-sided shape a tab each, full width and evenly split', () => {
    const html = list();
    expect(html).toContain('Side A');
    expect(html).toContain('Side B');
    expect(html).toContain('w-full');
    expect(html.match(/flex-1/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('puts a track behind the tabs and a pill on the live one', () => {
    const html = list();
    expect(html).toContain('tabs__list-container');
    expect(html).toContain('tabs__indicator');
  });

  it('leaves adding to the sheet, not to the list', () => {
    // the add control moved into the sheet's own footer: as a row at the end
    // of the list it scrolled away exactly when a long build-up made it
    // hardest to reach, and it cost a row of a screen that is half a phone
    expect(list()).not.toContain('Add layers');
  });

  it('numbers the layers in the order they went on', () => {
    const html = list({ rows: { a: [PLASTER, PAINT] } });
    expect(html).toContain('>1.<');
    expect(html).toContain('>2.<');
    expect(html).toContain('<ol');
    expect(html.indexOf('Plaster')).toBeLessThan(html.indexOf('>Paint<'));
  });

  it('puts the quantity on the row, not only behind the chevron', () => {
    // it is the answer the sheet exists to give; opening every row to find it
    // would be a tap per layer
    const html = list({ rows: { a: [TILE] } });
    expect(html).toContain('137.80 units');
  });

  it('gives every layer a remove and an expander, closed to start with', () => {
    const html = list({ rows: { a: [PLASTER, PAINT] } });
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Remove Plaster"');
    expect(html).toContain('aria-label="Details for Plaster"');
  });

  it('keeps the facts out of the markup until the row is opened', () => {
    const shut = list({ rows: { a: [PLASTER] } });
    expect(shut).not.toContain('net of openings');

    const open = list({
      rows: { a: [PLASTER] },
      opened: new Set([rowKey('a', PLASTER.id)]),
    });
    expect(open).toContain('12.40 m² net of openings');
    expect(open).toContain('plaster');
    expect(open).toContain('aria-expanded="true"');
  });

  it('shows the side that is selected, and not the other one', () => {
    const sides = { a: [PLASTER], b: [PAINT] };
    expect(list({ rows: sides, side: 'a' })).not.toContain('>Paint<');
    expect(list({ rows: sides, side: 'b' })).toContain('>Paint<');
  });

  it('opens a row on the side it was opened on, not on both', () => {
    const both = { a: [PLASTER], b: [PLASTER] };
    expect(
      list({ rows: both, side: 'a', opened: new Set(['a.f1']) }),
    ).toContain('aria-expanded="true"');
    expect(
      list({ rows: both, side: 'a', opened: new Set(['b.f1']) }),
    ).not.toContain('aria-expanded="true"');
  });

  it('keeps one scroller, not a list scrolling inside a sheet', () => {
    const html = list({
      rows: { a: [PLASTER, PAINT] },
      opened: new Set([rowKey('a', PLASTER.id), rowKey('a', PAINT.id)]),
    });
    expect(html).not.toContain('overflow-y-auto');
    expect(html).not.toContain('max-h-40');
  });

  it('says why a shape cannot carry a build-up, and offers nothing', () => {
    // core hosts a finish on a wall face and nowhere else, so most of the walk
    // has nowhere to put one. An Add button here would have nothing to
    // dispatch — and the sheet used to let the user fill a list that was never
    // going anywhere
    const html = list({
      kind: 'window',
      blocked:
        'A finish sits on a wall face, so a window cannot carry one yet.',
    });
    expect(html).toContain('cannot carry one yet');
    expect(html).not.toContain('Add layers');
    expect(html).not.toContain('Side A');
  });
});

describe('what a row says when it is opened', () => {
  it('names the area as net of openings', () => {
    const facts = finishFacts(PLASTER);
    expect(facts[0].value).toContain('net of openings');
  });

  it('gives a length material its length, and spares everything else', () => {
    // a trim is measured along the wall and nothing else; for an area material
    // the length line would just be a second way of saying the same thing
    const trim = row({ unit: 'm', quantity: 6 });
    expect(finishFacts(trim).some((f) => f.label === 'Length')).toBe(true);
    expect(finishFacts(PLASTER).some((f) => f.label === 'Length')).toBe(false);
  });

  it('always carries the cost code, which is what a rate is found by', () => {
    expect(finishFacts(TILE).some((f) => f.value === 'wall-tile')).toBe(true);
  });

  it('says so when there is no material to price it by', () => {
    const bare = row({ materialId: null, unpriced: true });
    expect(finishFacts(bare).some((f) => f.label === 'Note')).toBe(true);
  });

  it('writes a quantity in the unit the material is priced in', () => {
    expect(formatQuantity(12.4, 'm2')).toBe('12.40 m²');
    expect(formatQuantity(0.36, 'm3')).toBe('0.36 m³');
    expect(formatQuantity(6, 'm')).toBe('6.00 m');
    expect(formatQuantity(137.8, 'count')).toBe('137.80 units');
  });
});

describe('searching the catalogue', () => {
  it('answers everything for an empty search', () => {
    expect(matchesQuery(material(), '')).toBe(true);
    expect(matchesQuery(material(), '   ')).toBe(true);
  });

  it('matches the name however it was capitalised', () => {
    expect(matchesQuery(material({ name: 'Paint' }), 'paint')).toBe(true);
    expect(matchesQuery(material({ name: 'Paint' }), 'PAINT')).toBe(true);
  });

  it('matches the cost code too', () => {
    // the code is what an estimator who has seen the rate table knows it by
    const tile = material({ name: 'Wall tile', costCode: 'wall-tile' });
    expect(matchesQuery(tile, 'wall-tile')).toBe(true);
    expect(matchesQuery(tile, 'floor')).toBe(false);
  });

  it('falls back to the name when a material carries no code', () => {
    // the takeoff falls back the same way, so the sheet must not show a code
    // the bill will never use
    const bare = material({ name: 'Odd stuff', costCode: undefined });
    expect(codeOf(bare)).toBe('Odd stuff');
    expect(matchesQuery(bare, 'odd')).toBe(true);
  });
});

describe('the add sheet', () => {
  const MATERIALS = [
    material(),
    material({
      id: 'm2' as MaterialId,
      name: 'Paint',
      unit: 'm2',
      costCode: 'paint',
    }),
  ];

  const choices = ({
    materials = MATERIALS as readonly Material[],
    query = '',
    picked = NOTHING as ReadonlySet<string>,
    alreadyIn = NOTHING as ReadonlySet<string>,
  } = {}) =>
    renderToStaticMarkup(
      <LayerChoices
        materials={materials}
        query={query}
        picked={picked}
        alreadyIn={alreadyIn}
        onPick={noop}
        onEdit={noop}
      />,
    );

  it('points at the way out when the drawing has no materials at all', () => {
    // the starting state now that nothing is seeded: it names the one thing to
    // do rather than reporting an absence
    expect(choices({ materials: [] })).toContain('Add the first layer');
  });

  it('tells each row what it will be measured and priced by', () => {
    // the unit is the whole shape of the quantity: the same face is 12 m², or
    // 0.36 m³, or 138 tiles, depending only on this
    const html = choices();
    expect(html).toContain('by volume (m³)');
    expect(html).toContain('by area (m²)');
    expect(html).toContain('plaster');
  });

  it('carries the tile size for a count material', () => {
    // "138 tiles" is a different answer at 0.09 m² each than at 0.36
    const tile = material({ unit: 'count', coverage: 0.09 });
    expect(materialNote(tile)).toContain('0.09 m² each');
  });

  it('narrows to what was typed, and says when that is nothing', () => {
    const html = choices({ query: 'paint' });
    expect(html).toContain('>Paint<');
    expect(html).not.toContain('>Plaster<');
    expect(choices({ query: 'zzz' })).toContain('Nothing matches');
  });

  it('ticks more than one at a time', () => {
    const html = choices({ picked: new Set(['m1', 'm2']) });
    expect(html.match(/checked=""/g)).toHaveLength(2);
  });

  it('ticks nothing until the user does', () => {
    expect(choices()).not.toContain('checked=""');
  });

  it('shows what is already on the face as ticked and dead', () => {
    const html = choices({ alreadyIn: new Set(['m1']) });
    expect(html).toContain('Already on this side.');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('disabled=""');
  });
});

/**
 * The sheet is parked over the shape it is naming, and every camera box
 * `framing()` builds assumes it covers exactly `1 - CLEAR_FRACTION` of the
 * screen. Nothing used to hold it to that.
 */
describe('how much of the plan the sheet may cover', () => {
  it('leaves exactly the share the camera frames the shape into', () => {
    const covered = Number.parseFloat(SHEET_MAX_HEIGHT) / 100;
    expect(covered + CLEAR_FRACTION).toBeCloseTo(1);
  });

  it('measures it in svh, which a keyboard cannot move', () => {
    expect(SHEET_MAX_HEIGHT.endsWith('svh')).toBe(true);
    expect(SHEET_MAX_HEIGHT).not.toMatch(/\d(vh|dvh)$/);
  });
});

/**
 * Three controls and no more. Everything a finish carries can be edited
 * elsewhere in the app, so a second set of boxes here was a duplicate on the
 * screen with the least room for one. What survives is what an estimator
 * measures standing in the room.
 */
describe('the fields behind a row', () => {
  const fields = (r: FinishRow, openings: OpeningRow[] = []) =>
    renderToStaticMarkup(
      <FinishFields
        row={r}
        openings={openings}
        onEdit={noop}
        onDeduct={noop}
        onDemolish={noop}
        onDemolishToggle={noop}
        onDemolishOpening={noop}
      />,
    );

  const floorRow = (over: Partial<FinishRow> = {}) =>
    row({
      cover: {
        width: 6,
        height: 4,
        host: 'slab',
        t0: 0,
        sillHeight: 0,
        hostLength: 0,
        hostHeight: 0,
      },
      demolition: {
        width: 6,
        height: 4,
        id: null,
        on: false,
        costCode: 'demo-plaster',
        quantity: 0,
        priced: null,
      },
      ...over,
    });

  it('measures a wall up FROM THE GROUND, and says so', () => {
    const html = fields(row());
    expect(html).toContain('Width');
    expect(html).toContain('Height from ground');
    expect(html).toContain('value="6"');
    expect(html).toContain('value="3"');
  });

  it('measures a floor across the plan, so it has a length', () => {
    // calling both dimensions "height" made a floor read as though it stood
    // up; a floor is measured across the plan and has a length
    const html = fields(floorRow());
    expect(html).toContain('Width');
    expect(html).toContain('Length');
    expect(html).not.toContain('Height from ground');
  });

  it('states what is torn out beside what goes in', () => {
    // a layer is not either built or demolished: a room is stripped and then
    // rebuilt, and both quantities are real and both are priced
    expect(fields(row())).toContain('Demolition');
    expect(fields(floorRow())).toContain('Demolition');
  });

  it('offers a box per opening actually in the wall', () => {
    // "does the door go too" is a question about that door, not about the
    // layer, so it is one box per door rather than one switch for all of them
    const html = fields(row(), [
      { id: 'd1' as EntityId, name: 'Door D1', demolish: false },
      { id: 'w1' as EntityId, name: 'Window WN2', demolish: true },
    ]);
    expect(html).toContain('Take out Door D1');
    expect(html).toContain('Take out Window WN2');
  });

  it('offers no opening boxes on a floor', () => {
    const html = fields(floorRow());
    expect(html).not.toContain('Take out Door');
  });

  it('offers the opening toggle on a wall face only', () => {
    // a slab has no openings, and core rejects the flag for one — a floor
    // showing that switch would be offering a save that throws
    expect(fields(row())).toContain('Take out doors and windows');
    expect(fields(floorRow())).not.toContain('Take out doors and windows');
  });

  it('shows which way the openings are being measured', () => {
    expect(fields(row({ deductOpenings: true }))).toContain(
      'data-selected="true"',
    );
    expect(fields(row({ deductOpenings: false }))).not.toContain(
      'data-selected="true"',
    );
  });

  it('offers nothing at all where there is nowhere to write', () => {
    expect(fields(row({ cover: null }))).toBe('');
  });

  it('no longer duplicates what the rest of the app already edits', () => {
    // the sill, the extent, the thickness and the phase all moved out: one
    // more place for the same value to be wrong in is worse than a trip
    const html = fields(row());
    for (const gone of [
      'From floor',
      'Starts at',
      'Ends at',
      'Thickness',
      'Strip out',
    ]) {
      expect(html).not.toContain(gone);
    }
  });
});

/**
 * The sheet's metres have to become whichever extent the host actually keeps.
 * That arithmetic lives in `coverPatch`, away from the component, so it can be
 * checked without a DOM.
 */
describe('turning a width and a height into an edit', () => {
  const wall = {
    width: 6,
    height: 3,
    host: 'wall' as const,
    t0: 0,
    sillHeight: 0,
    hostLength: 6,
  };

  it('turns a wall width into a baseline parameter', () => {
    // 3 m of a 6 m wall, measured from where the band starts
    expect(coverPatch(wall, { width: 3 })).toEqual({ t1: 0.5 });
  });

  it('measures the height up from the sill, not from the floor', () => {
    const raised = { ...wall, sillHeight: 0.5 };
    expect(coverPatch(raised, { height: 1 })).toEqual({ topHeight: 1.5 });
  });

  it('sends only what changed on a wall', () => {
    // FINISH.UPDATE honours only the keys it is given, so a height edit must
    // not also restate a width the user never touched
    expect(coverPatch(wall, { height: 1.2 })).toEqual({ topHeight: 1.2 });
  });

  it('sends both halves on a floor, because core refuses half a rectangle', () => {
    const slab = { ...wall, host: 'slab' as const };
    expect(coverPatch(slab, { height: 2 })).toEqual({
      coverWidth: 6,
      coverHeight: 2,
    });
  });

  it('leaves a zero-length wall alone rather than dividing by it', () => {
    const degenerate = { ...wall, hostLength: 0 };
    expect(coverPatch(degenerate, { width: 3 })).toEqual({});
  });
});

/**
 * Bounds are not politeness. FINISH.UPDATE REJECTS a `t` outside 0..1 and a
 * `topHeight` at or below the sill, and a rejected dispatch inside a tap
 * handler is an unhandled throw out of a React event — the sheet dies rather
 * than the number being refused.
 */
describe('how far a figure may be typed', () => {
  const wall = {
    width: 6,
    height: 3,
    host: 'wall' as const,
    t0: 0,
    sillHeight: 0,
    hostLength: 6,
    hostHeight: 3,
  };

  it('stops a band at the end of its own wall', () => {
    // typing 9 on a 6 m wall would send t1 to 1.5, which the command throws on
    expect(coverBounds(wall).width.max).toBeCloseTo(6, 6);
  });

  it('measures the remaining run from where the band starts', () => {
    // a band starting a quarter along has three quarters of wall left to it
    const late = { ...wall, t0: 0.25 };
    expect(coverBounds(late).width.max).toBeCloseTo(4.5, 6);
  });

  it('stops a band at the head of its own wall', () => {
    expect(coverBounds(wall).height.max).toBeCloseTo(3, 6);
    // and from a raised sill there is less wall above it
    expect(coverBounds({ ...wall, sillHeight: 1 }).height.max).toBeCloseTo(
      2,
      6,
    );
  });

  it('leaves a floor unbounded, on purpose', () => {
    // a covered rectangle is a takeoff figure rather than a region, and one
    // larger than the drawn slab usually includes a threshold on purpose —
    // clamping it would be the drawing overruling somebody's tape
    const slab = { ...wall, host: 'slab' as const };
    expect(coverBounds(slab).width.max).toBeUndefined();
    expect(coverBounds(slab).height.max).toBeUndefined();
  });

  it('never lets a finish shrink to nothing', () => {
    // a finish of no size is not a measurement, it is a row that should have
    // been deleted
    for (const host of ['wall', 'slab'] as const) {
      const bounds = coverBounds({ ...wall, host });
      expect(bounds.width.min).toBeGreaterThan(0);
      expect(bounds.height.min).toBeGreaterThan(0);
    }
  });

  it('never hands back a max under the min', () => {
    // a degenerate wall must not produce a range nothing can satisfy
    const degenerate = { ...wall, hostLength: 0, hostHeight: 0 };
    const bounds = coverBounds(degenerate);
    expect(bounds.width.max).toBeGreaterThanOrEqual(bounds.width.min);
    expect(bounds.height.max).toBeGreaterThanOrEqual(bounds.height.min);
  });
});

describe('what a layer costs', () => {
  it('prices a quantity against its cost code', () => {
    expect(priceOf(DEMO_RATES, 'paint', 10)).toEqual({
      rate: 12,
      amount: 120,
    });
  });

  it('answers null for a code nobody has quoted', () => {
    // zero is a PRICE — it says this costs nothing — and a bill that quietly
    // totals unquoted work at nothing is the most expensive kind of wrong
    expect(priceOf(DEMO_RATES, 'demo-block', 10)).toBeNull();
  });

  it('bills a strip-out against its own demo code', () => {
    expect(demoCodeFor('wall-tile')).toBe('demo-wall-tile');
    // taking paint OFF costs a fraction of putting it on. Compared against
    // paint rather than tile on purpose: both are quoted per m², whereas a
    // tile is supplied by the unit and stripped by the area, so the two
    // numbers are not the same kind of thing and comparing them says nothing
    expect(DEMO_RATES.rates['demo-paint']?.unit).toBe(
      DEMO_RATES.rates['paint']?.unit,
    );
    expect(DEMO_RATES.rates['demo-paint']?.unitCost).toBeLessThan(
      DEMO_RATES.rates['paint']?.unitCost ?? 0,
    );
  });

  it('strips a tiled wall by the area, not by the tile', () => {
    // you do not count the tiles you are tearing off a wall
    expect(DEMO_RATES.rates['wall-tile']?.unit).toBe('count');
    expect(DEMO_RATES.rates['demo-wall-tile']?.unit).toBe('m2');
  });

  it('falls back to the generic strip-out with no material', () => {
    expect(demoCodeFor(null)).toBe('demo-finish');
  });

  it('shows the money on the row, beside the measurement', () => {
    // the quantity is the measurement and the money is the answer; a row with
    // only one of them sends the reader behind the chevron on every layer
    const html = list({ rows: { a: [PLASTER] } });
    expect(html).toContain('12.40 m²');
    expect(html).toContain('148.80 EUR');
  });

  it('marks the row when part of it has no rate', () => {
    // the amount says what it covers and the marker says what it does not; a
    // total that silently drops the unpriced half is the most expensive kind
    // of wrong an estimate can be
    // nothing quoted at all is not a price of nothing
    expect(list({ rows: { a: [row({ priced: null })] } })).toContain('no rate');

    // but a row that HAS a figure and is still carrying something unpriced
    // beside it says both
    const half = list({
      rows: {
        a: [
          row({
            demolition: {
              width: 6,
              height: 3,
              id: 'd1' as EntityId,
              on: true,
              costCode: 'demo-screed',
              quantity: 18,
              priced: null,
            },
          }),
        ],
      },
    });
    expect(half).toContain('148.80 EUR +');
  });

  it('moves the row total when demolition is switched on', () => {
    // the bug this pins: the row printed the build price alone, so turning
    // demolition on put real work and real money into the estimate and the
    // only number on screen did not move
    const off = layerTotal(row());
    const on = layerTotal(
      row({
        demolition: {
          width: 6,
          height: 3,
          id: 'd1' as EntityId,
          on: true,
          costCode: 'demo-plaster',
          quantity: 18,
          priced: { rate: 6, amount: 108 },
        },
      }),
    );
    expect(on.amount).toBeGreaterThan(off.amount);
    expect(on.amount).toBeCloseTo(148.8 + 108, 6);
  });

  it('ignores a strip-out that is switched off', () => {
    // a figure the estimate does not carry must not be added to it
    const parked = layerTotal(
      row({
        demolition: {
          width: 6,
          height: 3,
          id: null,
          on: false,
          costCode: 'demo-plaster',
          quantity: 18,
          priced: { rate: 6, amount: 108 },
        },
      }),
    );
    expect(parked.amount).toBeCloseTo(148.8, 6);
  });

  it('flags a strip-out nobody has quoted', () => {
    const total = layerTotal(
      row({
        demolition: {
          width: 6,
          height: 3,
          id: 'd1' as EntityId,
          on: true,
          costCode: 'demo-screed',
          quantity: 18,
          priced: null,
        },
      }),
    );
    expect(total.unquoted).toBe(true);
    expect(total.amount).toBeCloseTo(148.8, 6);
  });

  it('spells the arithmetic out behind the chevron', () => {
    // a single total is a number to be trusted; a rate times a quantity is a
    // number that can be checked
    const facts = finishFacts(PLASTER);
    expect(facts.some((f) => f.label === 'Rate')).toBe(true);
    expect(facts.some((f) => f.label === 'Amount')).toBe(true);
  });

  it('names the unquoted code rather than printing a zero', () => {
    const facts = finishFacts(row({ priced: null }));
    expect(facts.find((f) => f.label === 'Rate')?.value).toContain('plaster');
    expect(facts.some((f) => f.label === 'Amount')).toBe(false);
  });
});

/**
 * A switch that renders and cannot be pressed is worse than no switch: it
 * reads as a setting the user has already made. HeroUI's `Switch.Content` IS
 * the pressable element (react-aria's SwitchButton) — the track and thumb
 * alone are decoration.
 */
describe('the switches actually being pressable', () => {
  const fields = (r: FinishRow) =>
    renderToStaticMarkup(
      <FinishFields
        row={r}
        openings={[]}
        onEdit={noop}
        onDeduct={noop}
        onDemolish={noop}
        onDemolishToggle={noop}
        onDemolishOpening={noop}
      />,
    );

  it('wraps every switch in the element that takes the press', () => {
    // the bug this pins: a Switch with only Control and Thumb inside renders
    // a track, a thumb, and nothing that responds to a thumb
    const html = fields(row());
    const switches = html.match(/data-slot="switch"/g) ?? [];
    const pressable = html.match(/data-slot="switch-content"/g) ?? [];
    expect(switches.length).toBeGreaterThan(0);
    expect(pressable).toHaveLength(switches.length);
  });

  it('gives the switch a thumb to move', () => {
    expect(fields(row())).toContain('switch-thumb');
  });

  it('shows which way each switch is set', () => {
    expect(fields(row({ deductOpenings: true }))).toContain(
      'data-selected="true"',
    );
    expect(fields(row({ deductOpenings: false }))).not.toContain(
      'data-selected="true"',
    );
  });
});

describe('turning demolition on', () => {
  const fields = (r: FinishRow) =>
    renderToStaticMarkup(
      <FinishFields
        row={r}
        openings={[]}
        onEdit={noop}
        onDeduct={noop}
        onDemolish={noop}
        onDemolishToggle={noop}
        onDemolishOpening={noop}
      />,
    );

  const stripping = (over: Partial<FinishRow['demolition']> = {}) =>
    row({
      demolition: {
        width: 6,
        height: 3,
        id: 'd1' as EntityId,
        on: true,
        costCode: 'demo-plaster',
        quantity: 18,
        priced: { rate: 6, amount: 108 },
        ...over,
      },
    });

  it('offers the switch but no figures until it is on', () => {
    // boxes standing ready for a strip-out read as though one had already been
    // decided, and a strip-out nobody asked for prices every refurbishment as
    // a demolition
    const html = fields(row());
    expect(html).toContain('Demolition');
    expect(html).not.toContain('Nothing being taken off yet.');
  });

  it('shows the figures and the money once it is on', () => {
    const html = fields(stripping());
    expect(html).toContain('18.00 m²');
    expect(html).toContain('108.00 EUR');
  });

  it('says so when the strip-out has no rate', () => {
    // never a zero: a bill that totals unquoted work at nothing is the most
    // expensive kind of wrong
    const html = fields(stripping({ priced: null }));
    expect(html).toContain('no rate for demo-plaster yet');
  });
});
