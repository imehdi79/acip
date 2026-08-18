import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { EntityId, Material, MaterialId } from '@acip/editor-core';
import type { FinishRow } from '@/app/components/layout/footer/estimator-finishes';
import {
  LayerList,
  defaultSide,
  finishFacts,
  formatQuantity,
  rowKey,
  sidesFor,
} from '@/app/components/layout/footer/estimator-layers';
import { FinishFields } from '@/app/components/layout/footer/estimator-fields';
import { coverPatch } from '@/app/components/layout/footer/estimator-finishes';
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
  // a wall face by default, since that is the host that argues about openings;
  // the floor cases override host to 'slab'
  cover: {
    width: 6,
    height: 3,
    host: 'wall',
    t0: 0,
    sillHeight: 0,
    hostLength: 6,
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
      onAdd={noop}
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

  it('offers the add row whether there are tabs or not', () => {
    expect(list()).toContain('Add layers');
    expect(list({ kind: 'room' })).toContain('Add layers');
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
      />,
    );

  it('says so when the drawing has no materials at all', () => {
    expect(choices({ materials: [] })).toContain('no materials yet');
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
  const fields = (r: FinishRow) =>
    renderToStaticMarkup(
      <FinishFields row={r} onEdit={noop} onDeduct={noop} />,
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
      },
      ...over,
    });

  it('offers a width and a height, in metres, on a wall face', () => {
    const html = fields(row());
    expect(html).toContain('Width');
    expect(html).toContain('Height');
    expect(html).toContain('value="6"');
    expect(html).toContain('value="3"');
  });

  it('offers the same two on a floor', () => {
    // the document holds a floor as an unanchored rectangle and a wall as
    // parameters along a baseline; the sheet says width and height for both
    const html = fields(floorRow());
    expect(html).toContain('Width');
    expect(html).toContain('Height');
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
