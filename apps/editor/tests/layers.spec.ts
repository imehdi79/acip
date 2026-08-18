import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { LAYER_CATALOG, layersFor, loadLayers } from '@/data/layers';
import { estimatorSteps } from '@/app/components/layout/footer/estimator-steps';

/**
 * The catalogue is data behind an async seam, so the parts worth testing are
 * the lookup and — the one that actually bites — whether its keys are the same
 * words the walk uses for a kind of shape.
 */

describe('the layer catalogue', () => {
  it('offers layers for the shapes the estimator walks', async () => {
    for (const kind of ['wall', 'room', 'window', 'door']) {
      expect((await loadLayers(kind)).length).toBeGreaterThan(0);
    }
  });

  it('answers with nothing for a kind nobody has described', async () => {
    // a plan holds shapes nobody has written a build-up for; having none is an
    // answer, not a gap to paper over
    expect(await loadLayers('not-a-thing')).toEqual([]);
    expect(layersFor(LAYER_CATALOG, 'not-a-thing')).toEqual([]);
  });

  /*
   * The catalogue is keyed by `EstimatorStep.kind`, which is the ENTITY's own
   * type — not a name chosen here. Key it 'windows' and the add sheet silently
   * never offers anything for a window, with nothing to see but "No layers for
   * this yet". So the two are checked against each other rather than trusted to
   * agree.
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

    const kinds = new Set(
      estimatorSteps(session.doc, null).map((step) => step.kind),
    );
    expect(kinds).toEqual(new Set(['wall', 'room', 'window', 'door']));
    for (const kind of kinds) {
      expect((await loadLayers(kind)).length).toBeGreaterThan(0);
    }
  });

  it('gives every layer a name and a line saying what it covers', () => {
    /*
     * `description` is REQUIRED in the type, unlike the prose on the rates this
     * replaced: a layer carries no number, so a layer with no words is nothing
     * but an id and there is nothing on the row to choose between. The type
     * keeps the view honest; this keeps the DATA honest.
     */
    for (const layers of Object.values(LAYER_CATALOG)) {
      for (const layer of layers) {
        expect(layer.label.trim()).toBeTruthy();
        expect(layer.description.trim()).toBeTruthy();
        // no currency modelled anywhere in the app, and a layer holds no rate
        // at all — a description naming money would be inventing both
        expect(layer.description).not.toMatch(/[$€£¥]/);
      }
    }
  });

  it('namespaces every id by its kind, and repeats none of them', () => {
    // what keeps a list readable when a wall layer and a floor layer share a
    // word: `wall.skirting` and `room.skirting` are two different things and
    // must not be one id
    const seen = new Set<string>();
    for (const [kind, layers] of Object.entries(LAYER_CATALOG)) {
      for (const layer of layers) {
        expect(layer.id.startsWith(`${kind}.`)).toBe(true);
        expect(seen.has(layer.id)).toBe(false);
        seen.add(layer.id);
      }
    }
  });
});
