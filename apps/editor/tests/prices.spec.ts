import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { buildFor, loadBuilds, loadPrices, pricesFor } from '@/data/prices';
import { estimatorSteps } from '@/app/components/layout/footer/estimator-steps';

/**
 * The rate book is data behind an async seam, so the parts worth testing are
 * the lookup and — the one that actually bites — whether its keys are the same
 * words the walk uses for a kind of shape.
 */

describe('the rate book', () => {
  it('answers with rates for the shapes the estimator walks', async () => {
    const book = await loadPrices();
    for (const kind of ['wall', 'room', 'window', 'door']) {
      expect(pricesFor(book, kind).length).toBeGreaterThan(0);
    }
  });

  it('answers with nothing for a kind nobody has priced', async () => {
    const book = await loadPrices();
    // a plan holds stairs and slabs too; having no rates for them is an
    // answer, not a gap to paper over
    expect(pricesFor(book, 'stair')).toEqual([]);
    expect(pricesFor(book, 'not-a-thing')).toEqual([]);
  });

  it('gives every rate a label, a unit and a number', async () => {
    const book = await loadPrices();
    for (const rates of Object.values(book)) {
      for (const rate of rates) {
        expect(rate.label.length).toBeGreaterThan(0);
        expect(rate.unit.length).toBeGreaterThan(0);
        expect(rate.rate).toBeGreaterThan(0);
      }
    }
  });

  /*
   * `detail` is OPTIONAL in the type, because a book fetched from a server may
   * hold numbers and no prose, and the sheet has an on-screen answer for that.
   * It is not optional of the book that ships here: these twelve are written by
   * hand, and a hand that can write "Plaster, two coats" can write the line
   * saying it is measured per face. So the contract is checked where it lives —
   * the type keeps the view honest, this test keeps the DATA honest.
   */
  it('explains every rate it ships with', async () => {
    const book = await loadPrices();
    for (const rates of Object.values(book)) {
      for (const rate of rates) {
        expect(rate.detail?.trim()).toBeTruthy();
        // the row already prints the number, and there is still no currency
        // modelled for the line to name — writing one would invent it
        expect(rate.detail).not.toMatch(/[$€£¥]/);
      }
    }
  });

  /*
   * The book is keyed by `EstimatorStep.kind`, which is the ENTITY's own type
   * — not a name chosen here. Key it 'windows' and the list silently never
   * appears for a window, with nothing to see but an empty panel. So the two
   * are checked against each other rather than trusted to agree.
   */
  it('is keyed by the words the walk actually uses', async () => {
    const session = new EditorSession();
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    const walls = corners.map((a, i) =>
      session.dispatch<EntityId>('WALL.ADD', {
        a,
        b: corners[(i + 1) % corners.length],
        thickness: 0.3,
        height: 3,
      }),
    );
    session.dispatch('WINDOW.ADD', { wallId: walls[0], t: 0.5 });
    session.dispatch('DOOR.ADD', { wallId: walls[1], t: 0.5, width: 0.9 });

    const book = await loadPrices();
    const kinds = new Set(
      estimatorSteps(session.doc, null).map((step) => step.kind),
    );
    expect(kinds).toEqual(new Set(['wall', 'room', 'window', 'door']));
    const builds = await loadBuilds();
    for (const kind of kinds) {
      expect(pricesFor(book, kind).length).toBeGreaterThan(0);
      // the build item is keyed the same way, and gets the same guard: a key
      // that does not match a step's kind is a row that silently never appears
      expect(buildFor(builds, kind)).not.toBeNull();
    }
  });
});

/**
 * The build book is the same seam with a different shape: what a thing is made
 * OF rather than what it costs. Its ids are what the wizard carries between
 * steps, so the namespacing is not cosmetic — it is what stops a floor arriving
 * pre-answered as brick.
 */
describe('the build book', () => {
  it('says what every shape the estimator walks is built from', async () => {
    const builds = await loadBuilds();
    for (const kind of ['wall', 'room', 'window', 'door']) {
      const item = buildFor(builds, kind);
      expect(item?.label.trim()).toBeTruthy();
      expect(item?.detail.trim()).toBeTruthy();
      // a choice of one is not a choice; a picker needs somewhere to go
      expect(item?.options.length).toBeGreaterThan(1);
      for (const option of item?.options ?? []) {
        expect(option.label.trim()).toBeTruthy();
      }
    }
  });

  it('answers with nothing for a kind nobody has described', async () => {
    const builds = await loadBuilds();
    expect(buildFor(builds, 'stair')).toBeNull();
    expect(buildFor(builds, 'not-a-thing')).toBeNull();
  });

  it('namespaces every id by its kind', async () => {
    // what makes carrying the answers across Next safe: cross from the walls
    // into the rooms and nothing matches, so the sheet arrives blank rather
    // than quietly claiming the floor is made of brick
    const builds = await loadBuilds();
    for (const [kind, item] of Object.entries(builds)) {
      expect(item.id).toBe(`${kind}.built`);
      for (const option of item.options) {
        expect(option.id.startsWith(`${kind}.built.`)).toBe(true);
      }
    }
  });

  it('keeps a currency out of the prose, as the rates do', async () => {
    const builds = await loadBuilds();
    for (const item of Object.values(builds)) {
      expect(item.detail).not.toMatch(/[$€£¥]/);
    }
  });
});
