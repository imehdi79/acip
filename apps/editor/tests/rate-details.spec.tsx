import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  loadBuilds,
  loadPrices,
  type BuildItem,
  type PriceBook,
} from '@/data/prices';
import { Build, Rates } from '@/app/components/layout/footer/estimator';

/**
 * The estimator's items are the only part of the sheet the user can touch, and
 * both of their gestures are invisible to a test that only reads text: ticking
 * a rate flips a checkbox, opening one turns a chevron. So what is asserted
 * here is the ACCESSIBLE state — the checkbox's own `checked`, and
 * `aria-expanded` — which is both what a screen reader gets and the only thing
 * static markup can carry.
 *
 * <Rates/> and <Build/> are controlled precisely so this file can exist: there
 * is no DOM to tap in, so the states are handed in as props and the markup read
 * back.
 */

/**
 * A book of its own rather than the shipped one, so the assertions do not move
 * every time somebody prices a wall. The third rate carries NO detail — that is
 * the case the optional field exists for, and it must have an answer on screen.
 */
const BOOK: PriceBook = {
  wall: [
    {
      id: 'wall.block',
      label: 'Blockwork',
      unit: 'm²',
      rate: 48,
      detail: 'Blocks and mortar, taken on the elevation.',
    },
    {
      id: 'wall.paint',
      label: 'Paint',
      unit: 'm²',
      rate: 9.5,
      detail: 'Primer and topcoats, per face.',
    },
    { id: 'wall.render', label: 'Render', unit: 'm²', rate: 30 },
  ],
};

const NOTHING = new Set<string>();
const noop = () => undefined;

/** the list as the wizard renders it, at whatever state is asked for */
function list({
  book = BOOK,
  kind = 'wall',
  checked = NOTHING,
  opened = NOTHING,
}: {
  book?: PriceBook | null;
  kind?: string;
  checked?: ReadonlySet<string>;
  opened?: ReadonlySet<string>;
} = {}) {
  return renderToStaticMarkup(
    <Rates
      book={book}
      kind={kind}
      checked={checked}
      opened={opened}
      onCheck={noop}
      onToggleDetail={noop}
    />,
  );
}

describe('the rate list', () => {
  it('gives every rate an expander, closed to start with', () => {
    const html = list();
    // one per rate, and all shut: opening a row costs sheet height, so the
    // sheet must never arrive having spent it on the user's behalf
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(3);
    expect(html).not.toContain('aria-expanded="true"');
    // and each one names the rate it belongs to, because the chevron itself
    // says nothing out loud
    expect(html).toContain('aria-label="Details for Blockwork"');
  });

  it('keeps the detail out of the markup until the row is opened', () => {
    expect(list()).not.toContain('Blocks and mortar');

    const open = list({ opened: new Set(['wall.block']) });
    expect(open).toContain('Blocks and mortar, taken on the elevation.');
    expect(open).toContain('aria-expanded="true"');
    // exactly the one that was opened — the row's own state, not the list's
    expect(open).not.toContain('Primer and topcoats');
  });

  it('opens as many rows at once as the user asks for', () => {
    // comparing what two rates cover is why anyone opens them; an accordion
    // would make that a toggle back and forth
    const both = list({ opened: new Set(['wall.block', 'wall.paint']) });
    expect(both).toContain('Blocks and mortar');
    expect(both).toContain('Primer and topcoats');
    expect(both.match(/aria-expanded="true"/g)).toHaveLength(2);
  });

  it('says so out loud for a rate that carries no detail', () => {
    // the optional field's whole cost: a row that opened onto a blank strip
    // would read as a broken sheet rather than as a book with no prose in it
    const html = list({ opened: new Set(['wall.render']) });
    expect(html).toContain('No note on this one yet.');
  });

  it('numbers the rates in the order they are read', () => {
    // the numbers are what make the sheet sayable out loud — "we have got 1
    // and 3" — which a column of anonymous ticks cannot be
    const html = list();
    expect(html).toContain('>1.<');
    expect(html).toContain('>2.<');
    expect(html).toContain('>3.<');
    // an ordered list, so the numbering is the document's and not a decoration
    expect(html.startsWith('<ol')).toBe(true);
  });

  it('marks the ticked rates apart from the rest', () => {
    const html = list({ checked: new Set(['wall.paint']) });
    expect(html.match(/data-selected="true"/g)).toHaveLength(2); // row + label
    expect(html.match(/checked=""/g)).toHaveLength(1);
    // the ticked row is the one that was ticked, not merely some row
    const ticked = html.slice(html.indexOf('data-selected="true"'));
    expect(ticked.slice(0, ticked.indexOf('</label>'))).toContain('Paint');
  });

  it('ticks more than one rate at a time', () => {
    // the reason these are ticks and not a single pick: a wall is blockwork
    // AND plaster AND paint, not a choice between them
    const html = list({ checked: new Set(['wall.block', 'wall.paint']) });
    expect(html.match(/checked=""/g)).toHaveLength(2);
  });

  it('ticks nothing until the user does', () => {
    const html = list();
    expect(html).not.toContain('checked=""');
    expect(html).not.toContain('data-selected="true"');
  });

  it('stays capped and scrollable with every row open', () => {
    // the sheet is parked over the shape it is naming. Details render inside
    // the capped scroller, so opening all of them lengthens the LIST and the
    // sheet keeps its height — if this ever fails, the plan is being pushed
    // off the screen by the panel describing it
    const html = list({
      opened: new Set(['wall.block', 'wall.paint', 'wall.render']),
    });
    expect(html).toContain('max-h-32');
    expect(html).toContain('overflow-y-auto');
  });

  it('still says nothing is priced for a kind nobody has priced', async () => {
    // the walk covers stairs and slabs; having no rates for them is an answer,
    // and adding rows that can be tapped must not have turned it into a blank
    const book = await loadPrices();
    const html = list({ book, kind: 'stair' });
    expect(html).toContain('No rates for this yet.');
    expect(html).not.toContain('aria-expanded');
    expect(html).not.toContain('checked=""');
  });

  it('says the book is still coming rather than that there is nothing', () => {
    expect(list({ book: null })).toContain('Loading rates');
  });
});

/**
 * The build item is the estimate's first line and the only one that is a choice
 * rather than a tick. It behaves as a row in every other way — same checkbox,
 * same chevron, same detail — because it is literally the same component.
 */
describe('what the shape is built from', () => {
  const ITEM: BuildItem = {
    id: 'wall.built',
    label: 'Built from',
    detail: 'What the wall is made of.',
    options: [
      { id: 'wall.built.brick', label: 'Brick' },
      { id: 'wall.built.block', label: 'Concrete block' },
    ],
  };

  const build = ({
    item = ITEM as BuildItem | null,
    checked = false,
    open = false,
    option = '',
  } = {}) =>
    renderToStaticMarkup(
      <Build
        item={item}
        checked={checked}
        open={open}
        option={option}
        onCheck={noop}
        onToggleDetail={noop}
        onPick={noop}
      />,
    );

  it('offers every option, plus not having said yet', () => {
    const html = build();
    expect(html).toContain('<select');
    expect(html).toContain('Brick');
    expect(html).toContain('Concrete block');
    // nothing chosen is the honest starting state: defaulting to the first
    // option would have the sheet claim the user said "brick" when they have
    // said nothing at all
    expect(html).toContain('Choose…');
    expect(html).toContain('value=""');
  });

  it('shows the option that was chosen', () => {
    const html = build({ option: 'wall.built.block', checked: true });
    expect(html).toContain('selected=""');
    const chosen = html.slice(html.indexOf('selected=""'));
    expect(chosen.slice(0, chosen.indexOf('</option>'))).toContain(
      'Concrete block',
    );
    expect(html).toContain('checked=""');
  });

  it('carries the same tick and chevron as a rate row', () => {
    const html = build({ open: true });
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain('aria-label="Details for Built from"');
    expect(html).toContain('What the wall is made of.');
  });

  it('is not numbered — it is not one of the rates', () => {
    // a numbered place among them would read as one more line of the same
    // kind, when it is the thing they all hang off
    expect(build()).not.toContain('>1.<');
  });

  it('renders nothing at all for a kind nobody has described', async () => {
    expect(build({ item: null })).toBe('');
    const builds = await loadBuilds();
    expect(builds.stair).toBeUndefined();
  });
});
