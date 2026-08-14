import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { loadPrices, pricesFor } from '@/data/prices';
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
    for (const kind of kinds) {
      expect(pricesFor(book, kind).length).toBeGreaterThan(0);
    }
  });
});
