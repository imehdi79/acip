import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import {
  dimensionedSpan,
  planDimensions,
} from '@/editor/viewport/wall-dimensions';

/**
 * The lane and the drag readout used to answer "how long is this wall"
 * differently — 4.30 in the lane, 4.00 under the finger. Neither number was
 * wrong; they were two conventions with nothing saying which was in use.
 */
describe('what a wall measures', () => {
  it('reaches half a thickness past each end on the outside', () => {
    // a 4.00 baseline through 0.30 walls dimensions as 4.30
    expect(dimensionedSpan(4, 0.3, 'outside')).toBeCloseTo(4.3, 9);
  });

  it('stops half a thickness short of each end on the inside', () => {
    expect(dimensionedSpan(4, 0.3, 'inside')).toBeCloseTo(3.7, 9);
  });

  it('differs between the two modes by a whole thickness', () => {
    // half at each end is a thickness either way
    const out = dimensionedSpan(6, 0.25, 'outside');
    const inn = dimensionedSpan(6, 0.25, 'inside');
    expect(out - inn).toBeCloseTo(0.5, 9);
  });

  it('never reports a negative wall', () => {
    // a wall shorter than it is thick has no clear span; the drawn extent
    // beats a number below zero
    expect(dimensionedSpan(0.1, 0.3, 'inside')).toBe(0);
  });

  /*
   * The one that matters: the convention the drag uses has to be the SAME
   * convention the lane draws, or the two disagree on screen about one wall.
   * Checked against planDimensions itself rather than against a number written
   * down here, so the lane cannot move without this failing.
   */
  it('agrees with the dimension lane, in both modes', () => {
    const session = new EditorSession();
    const side = 4.3;
    const thickness = 0.3;
    const corners = [
      point(0, 0),
      point(side, 0),
      point(side, side),
      point(0, side),
    ];
    const walls = corners.map((a, i) =>
      session.dispatch<EntityId>('WALL.ADD', {
        a,
        b: corners[(i + 1) % corners.length],
        thickness,
        height: 3,
      }),
    );
    const view = { kind: 'plan', levelId: null } as const;

    for (const mode of ['outside', 'inside'] as const) {
      const lane = planDimensions(session.doc, view, new Set(), mode).find(
        (d) => d.entityId === walls[0] && d.kind === 'wall',
      );
      expect(lane).toBeDefined();
      // the drag knows only the baseline and the wall's own thickness — it
      // cannot ask the junctions, which are moving while it happens
      expect(dimensionedSpan(side, thickness, mode)).toBeCloseTo(
        lane?.length ?? -1,
        9,
      );
    }
  });

  it('agrees for a wall of a different thickness too', () => {
    const session = new EditorSession();
    const side = 5;
    const thickness = 0.2;
    const corners = [
      point(0, 0),
      point(side, 0),
      point(side, side),
      point(0, side),
    ];
    const walls = corners.map((a, i) =>
      session.dispatch<EntityId>('WALL.ADD', {
        a,
        b: corners[(i + 1) % corners.length],
        thickness,
        height: 3,
      }),
    );
    const view = { kind: 'plan', levelId: null } as const;
    for (const mode of ['outside', 'inside'] as const) {
      const lane = planDimensions(session.doc, view, new Set(), mode).find(
        (d) => d.entityId === walls[0] && d.kind === 'wall',
      );
      expect(dimensionedSpan(side, thickness, mode)).toBeCloseTo(
        lane?.length ?? -1,
        9,
      );
    }
  });
});
