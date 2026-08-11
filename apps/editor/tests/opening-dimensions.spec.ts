import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, HostedOpeningEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import {
  openingExtent,
  planDimensions,
} from '@/editor/viewport/wall-dimensions';

/**
 * Windows and doors are dimensioned like the walls they sit in: each prints
 * its WIDTH, laid out by the same pass, so an opening's number never lands on
 * top of its wall's own — it takes the next lane out instead.
 */

const PLAN: ViewDefinition = { kind: 'plan', levelId: null };

let session: EditorSession;

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const room = (x0: number, y0: number, x1: number, y1: number) => {
  const corners = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return corners.map((a, i) => addWall(a, corners[(i + 1) % corners.length]));
};

const addWindow = (wallId: EntityId, t: number, width: number) =>
  session.dispatch<EntityId>('WINDOW.ADD', { wallId, t, width });

const dims = (selection?: ReadonlySet<string>) =>
  planDimensions(session.doc, PLAN, selection);

const dimOf = (id: EntityId, selection?: ReadonlySet<string>) =>
  dims(selection).find((d) => d.entityId === id);

const opening = (id: EntityId) => session.doc.get(id) as HostedOpeningEntity;

beforeEach(() => {
  session = new EditorSession();
});

describe('openingExtent', () => {
  it('measures the opening across its own two end grips', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const id = addWindow(wall, 0.3, 1.2);

    const extent = openingExtent(opening(id))!;
    expect(extent.kind).toBe('opening');
    expect(extent.length).toBeCloseTo(1.2, 6);
    // centred at 3 m of 10, so 2.4 → 3.6, and on the wall's own axis
    expect(Math.min(extent.a.x, extent.b.x)).toBeCloseTo(2.4, 6);
    expect(Math.max(extent.a.x, extent.b.x)).toBeCloseTo(3.6, 6);
    expect(extent.a.y).toBeCloseTo(0, 9);
    expect(extent.b.y).toBeCloseTo(0, 9);
  });

  it('reports a length that matches its own anchors', () => {
    const wall = addWall(point(0, 0), point(6, 8)); // 10 m, angled
    const id = addWindow(wall, 0.5, 2);

    const extent = openingExtent(opening(id))!;
    expect(
      Math.hypot(extent.b.x - extent.a.x, extent.b.y - extent.a.y),
    ).toBeCloseTo(extent.length, 9);
  });

  it('has nothing to measure without a host', () => {
    const wall = addWall(point(0, 0), point(4, 0));
    const id = addWindow(wall, 0.5, 1);
    const orphan = opening(id);
    session.dispatch('ENTITY.ERASE', { ids: [wall] });

    expect(openingExtent(orphan)).toBeNull();
  });
});

describe('opening dimensions on the plan', () => {
  it('gives every opening a dimension of its width', () => {
    const walls = room(0, 0, 8, 5);
    const window = addWindow(walls[0], 0.4, 1.2);
    const door = session.dispatch<EntityId>('DOOR.ADD', {
      wallId: walls[1],
      t: 0.5,
      width: 0.9,
    });

    const measured = dims().filter((d) => d.kind === 'opening');
    expect(measured.map((d) => d.entityId).sort()).toEqual(
      [window, door].sort(),
    );
    expect(dimOf(window)!.length).toBeCloseTo(1.2, 6);
    expect(dimOf(door)!.length).toBeCloseTo(0.9, 6);
  });

  it('follows the opening when it is widened', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const id = addWindow(wall, 0.3, 1.2);
    session.dispatch('GRIP.MOVE', { id, index: 2, to: point(5, 0) });

    // grip 2 dragged to 5 m with the far end pinned at 2.4
    expect(dimOf(id)!.length).toBeCloseTo(2.6, 6);
  });

  it('drops the dimension when the opening is erased', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const id = addWindow(wall, 0.3, 1.2);
    session.dispatch('ENTITY.ERASE', { ids: [id] });

    expect(dims().every((d) => d.kind === 'wall')).toBe(true);
  });

  it('measures nothing in 3D', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    addWindow(wall, 0.3, 1.2);
    expect(planDimensions(session.doc, { kind: '3d' })).toEqual([]);
  });
});

describe('openings in the lane layout', () => {
  it('stands the opening clear of its host wall', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const id = addWindow(wall, 0.3, 1.2);

    // both sit on the wall's line and the window is inside the wall's span,
    // so drawing them in one lane would print one number over the other
    expect(dimOf(wall)!.lane).toBe(0);
    expect(dimOf(id)!.lane).toBe(1);
    expect(dimOf(id)!.side).toEqual(dimOf(wall)!.side);
  });

  it('lets two openings on one wall share a lane', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const near = addWindow(wall, 0.2, 1.2);
    const far = addWindow(wall, 0.7, 1.2);

    // separate stretches of the same line never cover each other, so neither
    // window costs a lane the next dimension out would have to clear
    expect(dimOf(near)!.lane).toBe(1);
    expect(dimOf(far)!.lane).toBe(1);
  });

  it('does not disturb the walls it joins', () => {
    const walls = room(0, 0, 8, 5);
    const before = dims();
    addWindow(walls[0], 0.4, 1.2);

    const after = dims().filter((d) => d.kind === 'wall');
    expect(after).toEqual(before);
  });

  it('gives openings on parallel walls their own lines', () => {
    // different stretches of x on the two sides of a room: metres apart, so
    // neither costs the other a lane
    const walls = room(0, 0, 8, 5);
    const lower = addWindow(walls[0], 0.4, 1.2);
    const upper = addWindow(walls[2], 0.3, 1.2);

    expect(dimOf(lower)!.lane).toBe(1);
    expect(dimOf(upper)).toBeDefined();
  });

  it('prints one number when two openings measure the same span', () => {
    // aligned windows on the two sides of a room, the opening version of a
    // room's top and bottom wall measuring the same width: saying 1.20 twice
    // is what the de-duplication exists to stop
    const walls = room(0, 0, 8, 5);
    const lower = addWindow(walls[0], 0.4, 1.2);
    const upper = addWindow(walls[2], 0.6, 1.2);

    expect(dims().filter((d) => d.kind === 'opening')).toHaveLength(1);
    expect(dimOf(lower)).toBeDefined();
    // and selecting the other one hands it that dimension, so the highlight
    // always has something to land on
    expect(dimOf(upper, new Set([upper]))?.selected).toBe(true);
  });
});

describe('selection', () => {
  it('flags the selected opening, and only it', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const id = addWindow(wall, 0.3, 1.2);
    const picked = new Set([id]);

    expect(dimOf(id, picked)!.selected).toBe(true);
    expect(dimOf(wall, picked)!.selected).toBe(false);
  });

  it('flags nothing when nothing is selected', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    addWindow(wall, 0.3, 1.2);
    expect(dims().every((d) => d.selected === false)).toBe(true);
  });
});
