import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, LayerId } from '@acip/editor-core';
import {
  STOREY_HEIGHT,
  floorLabel,
  nextElevation,
  nextFloorName,
} from '@/app/components/layout/footer/floors';
import { estimatorSteps } from '@/app/components/layout/footer/estimator-steps';
import { DANGER_ZONE_LAYER } from '@/editor/danger-zone';

describe('where the next floor goes', () => {
  it('starts a building at the ground', () => {
    expect(nextFloorName([])).toBe('Ground floor');
    expect(nextElevation([])).toBe(0);
  });

  it('puts each floor a storey above the highest one', () => {
    // a storey, not a metre: a floor added here has to land on TOP of the
    // walls below it rather than halfway up them
    const ground = { id: 'l1' as never, name: 'Ground floor', elevation: 0 };
    expect(nextElevation([ground])).toBe(STOREY_HEIGHT);
    const first = { id: 'l2' as never, name: 'Floor 1', elevation: 3 };
    expect(nextElevation([ground, first])).toBe(STOREY_HEIGHT * 2);
  });

  it('measures from the highest floor, not the last one added', () => {
    // levels come back sorted by elevation, but nothing promises the list
    // handed here is; stacking on the wrong one buries a floor in a wall
    const levels = [
      { id: 'l2' as never, name: 'Floor 1', elevation: 3 },
      { id: 'l1' as never, name: 'Ground floor', elevation: 0 },
    ];
    expect(nextElevation(levels)).toBe(6);
  });
});

describe('what the floor button says', () => {
  const levels = [
    { id: 'l1' as never, name: 'Ground floor', elevation: 0 },
    { id: 'l2' as never, name: 'Floor 1', elevation: 3 },
  ];

  it('names the floor being drawn', () => {
    expect(floorLabel(levels, levels[1].id)).toBe('Floor 1');
  });

  it('says All floors for the state the editor starts in', () => {
    // "all" is a real choice and the default, not a none to be tidied away: a
    // plan drawn before levels existed carries no level at all
    expect(floorLabel(levels, null)).toBe('All floors');
  });

  it('falls back to All floors for a level that has gone', () => {
    expect(floorLabel(levels, 'deleted' as never)).toBe('All floors');
  });
});

/**
 * The danger zone's layer is hidden exactly when the zone is closed. That work
 * is the change being priced — leaving it out would quote the building as
 * though nobody had proposed anything.
 */
describe('danger zone work in the walk', () => {
  function planWithZone() {
    const session = new EditorSession();
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    for (const [i, a] of corners.entries()) {
      session.dispatch<EntityId>('WALL.ADD', {
        a,
        b: corners[(i + 1) % corners.length],
        thickness: 0.3,
        height: 3,
      });
    }
    // the zone, as danger-zone.ts makes it: one named layer, hidden when shut
    const layerId = session.dispatch<LayerId>('LAYER.ADD', {
      name: DANGER_ZONE_LAYER,
      color: '#e5484d',
    });
    session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 8),
      b: point(6, 8),
      thickness: 0.3,
      height: 3,
      layerId,
    });
    return { session, layerId };
  }

  it('walks the zone while it is open', () => {
    const { session } = planWithZone();
    expect(
      estimatorSteps(session.doc, null).filter((s) => s.kind === 'wall'),
    ).toHaveLength(5);
  });

  it('still walks it once the zone is shut', () => {
    // an estimate must not change depending on which mode the footer is in
    const { session, layerId } = planWithZone();
    session.dispatch('LAYER.UPDATE', { id: layerId, visible: false });
    expect(
      estimatorSteps(session.doc, null).filter((s) => s.kind === 'wall'),
    ).toHaveLength(5);
  });

  it('still hides an ordinary layer that was turned off', () => {
    // the exception is the danger zone and nothing else — a layer somebody
    // switched off is switched off
    const { session } = planWithZone();
    const other = session.dispatch<LayerId>('LAYER.ADD', { name: 'Scratch' });
    session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 12),
      b: point(6, 12),
      thickness: 0.3,
      height: 3,
      layerId: other,
    });
    expect(
      estimatorSteps(session.doc, null).filter((s) => s.kind === 'wall'),
    ).toHaveLength(6);
    session.dispatch('LAYER.UPDATE', { id: other, visible: false });
    expect(
      estimatorSteps(session.doc, null).filter((s) => s.kind === 'wall'),
    ).toHaveLength(5);
  });
});
