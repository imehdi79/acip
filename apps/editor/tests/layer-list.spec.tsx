import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { LayerOption } from '@/data/layers';
import {
  LayerList,
  layerDetail,
  rowKey,
  sidesFor,
} from '@/app/components/layout/footer/estimator-layers';
import {
  LayerChoices,
  matchesQuery,
} from '@/app/components/layout/footer/estimator-add-layers';
import {
  CLEAR_FRACTION,
  SHEET_MAX_HEIGHT,
} from '@/app/components/layout/footer/estimator';

/**
 * The estimator's list is the only part of the sheet the user builds, and most
 * of what it does is invisible to a test that only reads text: removing a layer
 * presses an icon, opening one turns a chevron. So what is asserted here is the
 * ACCESSIBLE state — the labels on the icon-only buttons, and `aria-expanded` —
 * which is both what a screen reader gets and the only thing static markup can
 * carry.
 *
 * <LayerList/> and <LayerChoices/> are controlled precisely so this file can
 * exist: there is no DOM to tap in, so the states are handed in as props and
 * the markup read back.
 */

/** layers of its own rather than the shipped ones, so assertions do not move */
const PLASTER: LayerOption = {
  id: 'wall.plaster',
  label: 'Plaster, two coats',
  description: 'Scratch and finish coat to this face.',
};
const PAINT: LayerOption = {
  id: 'wall.paint',
  label: 'Paint',
  description: 'Primer and topcoats over the finished face.',
};
const SCREED: LayerOption = {
  id: 'room.screed',
  label: 'Floor screed',
  description: 'Levelling screed over the slab.',
};

const NOTHING = new Set<string>();
const noop = () => undefined;

/** the list as the wizard renders it, at whatever state is asked for */
function list({
  kind = 'wall',
  side = 'a',
  lists = {} as Readonly<Record<string, readonly LayerOption[]>>,
  opened = NOTHING as ReadonlySet<string>,
} = {}) {
  return renderToStaticMarkup(
    <LayerList
      kind={kind}
      side={side}
      lists={lists}
      opened={opened}
      onSideChange={noop}
      onToggleDetail={noop}
      onRemove={noop}
      onAdd={noop}
    />,
  );
}

describe('which sides a shape has', () => {
  it('gives a room one list and no second side to hide behind a tab', () => {
    // a room is a volume, not a face: there is no second copy of its floor
    expect(sidesFor('room')).toHaveLength(1);
  });

  it('gives everything else two', () => {
    // a wall is plastered both faces, a door painted differently each side —
    // and a kind nobody has thought about yet gets two rather than losing one
    for (const kind of ['wall', 'door', 'window', 'slab', 'not-a-thing']) {
      expect(sidesFor(kind)).toHaveLength(2);
    }
  });

  it('starts both of them at the same side id', () => {
    // what lets a shape's state name its open side before anyone has looked at
    // which kind it is
    expect(sidesFor('room')[0].id).toBe('a');
    expect(sidesFor('wall')[0].id).toBe('a');
  });
});

describe('the layer list', () => {
  it('is empty to start with, and says what to do about it', () => {
    // Empty is the STARTING state, not a failure. The sheet used to arrive
    // holding a book of rates nobody had said were true of this shape; if this
    // ever fails, it is claiming a build-up the user has not stated.
    const html = list();
    expect(html).toContain('Nothing here yet');
    expect(html).not.toContain('<ol');
    expect(html).not.toContain('aria-expanded');
  });

  it('is empty on a room too, with no tabs over it', () => {
    const html = list({ kind: 'room' });
    expect(html).toContain('Nothing here yet');
    // a tab bar with one tab in it is a control that cannot be used, spending
    // a row of a phone's screen to say nothing
    expect(html).not.toContain('Side A');
    expect(html).not.toContain('Side B');
  });

  it('gives a two-sided shape a tab each', () => {
    const html = list();
    expect(html).toContain('Side A');
    expect(html).toContain('Side B');
  });

  it('gives the tab bar the whole width, split evenly', () => {
    // a two-option segmented control that does not span the sheet reads as two
    // words floating over it, and gives each option less than half a phone to
    // be tapped in. `w-full` beats the track's own `w-max`; `flex-1` is what
    // makes the two halves equal rather than as wide as their words
    const html = list();
    expect(html).toContain('w-full');
    expect(html.match(/flex-1/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('puts a track behind the tabs and a pill on the live one', () => {
    // without ListContainer HeroUI falls back to a bare list with no track, and
    // without the Indicator the selected tab is a colour change and nothing
    // else — between them they are the difference between a segmented control
    // and two words
    const html = list();
    expect(html).toContain('tabs__list-container');
    expect(html).toContain('tabs__indicator');
  });

  it('offers the add row whether there are tabs or not', () => {
    // the one way anything gets onto an empty list, so it must survive both
    // shapes of the panel. A labelled full-width row, not an icon in a field
    // of empty space — the control that is useless to miss is the one that
    // gets the whole width
    expect(list()).toContain('Add layers');
    expect(list({ kind: 'room' })).toContain('Add layers');
  });

  it('numbers the layers in the order they go on', () => {
    // the numbers are a PRIORITY, not a decoration: render under skim under
    // paint is a wall, and the reverse is not
    const html = list({ lists: { a: [PLASTER, PAINT] } });
    expect(html).toContain('>1.<');
    expect(html).toContain('>2.<');
    // an ordered list, so the numbering is the document's and not a decoration
    expect(html).toContain('<ol');
    const first = html.indexOf('Plaster, two coats');
    expect(first).toBeGreaterThan(-1);
    expect(first).toBeLessThan(html.indexOf('>Paint<'));
  });

  it('gives every layer a remove and an expander, closed to start with', () => {
    const html = list({ lists: { a: [PLASTER, PAINT] } });
    // one expander per layer, and all shut: opening a row costs sheet height,
    // and the sheet must never arrive having spent it on the user's behalf
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(2);
    expect(html).not.toContain('aria-expanded="true"');
    // the icons carry no text, so each names the layer it belongs to
    expect(html).toContain('aria-label="Remove Plaster, two coats"');
    expect(html).toContain('aria-label="Details for Plaster, two coats"');
  });

  it('keeps the detail out of the markup until the row is opened', () => {
    const shut = list({ lists: { a: [PLASTER, PAINT] } });
    expect(shut).not.toContain('Scratch and finish coat');

    const open = list({
      lists: { a: [PLASTER, PAINT] },
      opened: new Set([rowKey('a', PLASTER.id)]),
    });
    expect(open).toContain(layerDetail(PLASTER));
    expect(open).toContain('aria-expanded="true"');
    // exactly the one that was opened — the row's own state, not the list's
    expect(open).not.toContain('Primer and topcoats');
  });

  it('says something different for every layer it opens', () => {
    // the detail is a placeholder for inputs that differ per layer, so the one
    // thing it must already do is CHANGE — a fixed string here would be a
    // panel that says nothing about the row it belongs to
    expect(layerDetail(PLASTER)).not.toBe(layerDetail(PAINT));
    expect(layerDetail(PLASTER)).toContain('Plaster, two coats');
    expect(layerDetail(SCREED)).toContain('Floor screed');
  });

  it('opens a row on the side it was opened on, not on both', () => {
    // plaster is usually on BOTH faces of a wall, so keying an open row by the
    // layer alone would tie the two rows together and open them as one
    const both = { a: [PLASTER], b: [PLASTER] };
    const onA = list({
      lists: both,
      side: 'a',
      opened: new Set(['a.wall.plaster']),
    });
    expect(onA).toContain('aria-expanded="true"');

    // the same shape, the same layer, showing side A — with only B's row open
    const onB = list({
      lists: both,
      side: 'a',
      opened: new Set(['b.wall.plaster']),
    });
    expect(onB).not.toContain('aria-expanded="true"');
  });

  it('shows the side that is selected, and not the other one', () => {
    const sides = { a: [PLASTER], b: [PAINT] };
    expect(list({ lists: sides, side: 'a' })).not.toContain('>Paint<');
    expect(list({ lists: sides, side: 'b' })).toContain('>Paint<');
  });

  it('keeps one scroller, not a list scrolling inside a sheet', () => {
    // the list used to carry its own cap and scroller. With the sheet itself
    // capped (SHEET_MAX_HEIGHT) that second surface bought nothing and cost
    // real confusion under a thumb: a drag that reached the end of the inner
    // list stopped dead instead of moving the sheet
    const html = list({
      lists: { a: [PLASTER, PAINT] },
      opened: new Set([rowKey('a', PLASTER.id), rowKey('a', PAINT.id)]),
    });
    expect(html).not.toContain('overflow-y-auto');
    expect(html).not.toContain('max-h-40');
  });
});

/**
 * The sheet is parked over the shape it is naming, and every camera box
 * `framing()` builds assumes it covers exactly `1 - CLEAR_FRACTION` of the
 * screen. Nothing used to hold it to that — the dialog's own rule is
 * `max-h-full` against a container sized by `--visual-viewport-height`, which
 * moves when a keyboard opens over it.
 */
describe('how much of the plan the sheet may cover', () => {
  it('leaves exactly the share the camera frames the shape into', () => {
    const covered = Number.parseFloat(SHEET_MAX_HEIGHT) / 100;
    expect(covered + CLEAR_FRACTION).toBeCloseTo(1);
  });

  it('measures it in svh, which a keyboard cannot move', () => {
    // the add sheet stacks a search field over this one, which is exactly how
    // a keyboard gets opened over the estimator. `vh` and the viewport-derived
    // custom property both move when it does; `svh` is pinned to the largest
    // browser chrome and does not
    expect(SHEET_MAX_HEIGHT.endsWith('svh')).toBe(true);
    expect(SHEET_MAX_HEIGHT).not.toMatch(/\d(vh|dvh)$/);
  });
});

describe('searching the catalogue', () => {
  it('answers everything for an empty search', () => {
    expect(matchesQuery(PLASTER, '')).toBe(true);
    expect(matchesQuery(PLASTER, '   ')).toBe(true);
  });

  it('matches the name however it was capitalised', () => {
    // a phone keyboard capitalises the first letter of a field on its own, and
    // nobody meant to search for `Paint` and not `paint`
    expect(matchesQuery(PAINT, 'paint')).toBe(true);
    expect(matchesQuery(PAINT, 'PAINT')).toBe(true);
    expect(matchesQuery(PAINT, ' Pain ')).toBe(true);
  });

  it('matches the description too', () => {
    // half of what separates two layers lives in the prose: type "face" and
    // the plaster that says "to this face" is a better answer than anything
    // with the word in its name
    expect(matchesQuery(PLASTER, 'face')).toBe(true);
    expect(matchesQuery(PAINT, 'face')).toBe(true);
    expect(matchesQuery(SCREED, 'face')).toBe(false);
  });
});

describe('the add sheet', () => {
  const choices = ({
    layers = [PLASTER, PAINT] as readonly LayerOption[] | null,
    query = '',
    picked = NOTHING as ReadonlySet<string>,
    alreadyIn = NOTHING as ReadonlySet<string>,
  } = {}) =>
    renderToStaticMarkup(
      <LayerChoices
        layers={layers}
        query={query}
        picked={picked}
        alreadyIn={alreadyIn}
        onPick={noop}
      />,
    );

  it('says the catalogue is still coming rather than that there is nothing', () => {
    expect(choices({ layers: null })).toContain('Loading layers');
  });

  it('says so for a kind nobody has described', () => {
    // the walk covers shapes nobody has written a build-up for; having none is
    // an answer, not a blank sheet to stare at
    expect(choices({ layers: [] })).toContain('No layers for this yet.');
  });

  it('gives every row the prose that separates it from the next', () => {
    const html = choices();
    expect(html).toContain('Scratch and finish coat to this face.');
    expect(html).toContain('Primer and topcoats over the finished face.');
  });

  it('narrows to what was typed, and says when that is nothing', () => {
    const html = choices({ query: 'paint' });
    expect(html).toContain('>Paint<');
    expect(html).not.toContain('Plaster, two coats');
    expect(choices({ query: 'zzz' })).toContain('Nothing matches');
  });

  it('ticks more than one at a time', () => {
    // the reason these are ticks and not a single pick: a wall face is render
    // AND skim AND paint, and the sheet exists to add a build-up in one visit
    const html = choices({ picked: new Set([PLASTER.id, PAINT.id]) });
    expect(html.match(/checked=""/g)).toHaveLength(2);
  });

  it('ticks nothing until the user does', () => {
    expect(choices()).not.toContain('checked=""');
  });

  it('shows what is already on the side as ticked and dead', () => {
    // hiding it would answer "why is plaster not in this list" with silence,
    // and the sheet would look like a shorter catalogue on every later visit
    const html = choices({ alreadyIn: new Set([PLASTER.id]) });
    expect(html).toContain('Already on this side.');
    expect(html.match(/checked=""/g)).toHaveLength(1);
    expect(html).toContain('disabled=""');
  });
});
