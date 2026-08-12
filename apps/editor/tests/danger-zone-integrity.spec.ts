import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { enterDangerZone, leaveDangerZone } from '@/editor/danger-zone';
import { duplicateSelection } from '@/app/components/layout/footer/duplicate';

/**
 * The one promise the danger zone makes: while it is on, the original plan
 * does not change. Not by a drag, not by a wall drawn across it, not by any
 * button in the bar.
 *
 * These go at it through the real tools rather than checking each guard in
 * isolation — the promise is only kept if EVERY path keeps it, and the paths
 * are what a finger can actually reach.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;
let original: EntityId[];

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

/** the original plan, frozen as text, so any change at all shows up */
const survey = () =>
  original
    .map((id) => {
      const wall = session.doc.get(id) as WallEntity | null;
      if (!wall) return `${id}: GONE`;
      const { a, b } = wall.getBaseline();
      return `${id}: ${a.x},${a.y}→${b.x},${b.y} t=${wall.getThickness()}`;
    })
    .join('\n');

const drag = (from: Point, to: Point) => {
  runtime.tools.pointerDown({
    point: from,
    modifiers: NO_MODS,
    snapped: false,
  });
  runtime.tools.pointerMove({ point: to, modifiers: NO_MODS, snapped: false });
  runtime.tools.pointerUp({ point: to, modifiers: NO_MODS, snapped: false });
};

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.2;
  runtime.tools.useById('select');
  // a plain room, drawn before anyone opened the zone
  const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
  original = corners.map((a, i) =>
    addWall(a, corners[(i + 1) % corners.length]),
  );
});

describe('with the zone open, the original plan holds', () => {
  let before: string;

  beforeEach(() => {
    enterDangerZone(session, runtime.ui);
    before = survey();
  });

  it('a tap cannot even select it', () => {
    drag(point(3, 0), point(3, 0));
    expect(session.selection.list()).toEqual([]);
  });

  it('a drag across it moves nothing', () => {
    drag(point(3, 0), point(3, -2));
    expect(survey()).toBe(before);
  });

  it('a drag from one of its corners stretches nothing', () => {
    drag(point(0, 0), point(-2, -2));
    expect(survey()).toBe(before);
  });

  it('a new wall drawn straight across it does not split it', () => {
    runtime.tools.useById('wall');
    drag(point(3, -2), point(3, 6));
    runtime.tools.useById('select');

    expect(survey()).toBe(before);
  });

  it('a new wall drawn along it does not absorb it', () => {
    runtime.tools.useById('wall');
    drag(point(0, 0), point(6, 0));
    runtime.tools.useById('select');

    // the original is untouched and the new one gave up the shared run
    expect(survey()).toBe(before);
  });

  it('a box selection sweeps up none of it', () => {
    drag(point(-2, -2), point(9, 7));
    expect(session.selection.list()).toEqual([]);
  });

  it('deleting with nothing selectable erases nothing', () => {
    session.dispatch('ENTITY.ERASE', { ids: session.selection.list() });
    expect(survey()).toBe(before);
  });

  it('duplicate has nothing of it to copy', () => {
    duplicateSelection(session, runtime.ui);
    expect(survey()).toBe(before);
  });

  it('survives the lot, one after another', () => {
    drag(point(3, 0), point(3, -2));
    drag(point(0, 0), point(-2, -2));
    drag(point(-2, -2), point(9, 7));
    runtime.tools.useById('wall');
    drag(point(3, -2), point(3, 6));
    drag(point(-1, 2), point(7, 2));
    runtime.tools.useById('select');
    duplicateSelection(session, runtime.ui);

    expect(survey()).toBe(before);
  });
});

describe('what the zone still lets you do', () => {
  beforeEach(() => {
    enterDangerZone(session, runtime.ui);
  });

  it('draws new walls, on its own layer', () => {
    runtime.tools.useById('wall');
    drag(point(0, 6), point(6, 6));
    runtime.tools.useById('select');

    const zone = session.doc
      .all()
      .filter(
        (e): e is WallEntity =>
          e instanceof WallEntity && !original.includes(e.id),
      );
    expect(zone.length).toBeGreaterThan(0);
    const layer = session.doc.getLayer(zone[0].layerId);
    expect(layer?.name).toBe('Danger zone');
    expect(layer?.color).toBe('#e5484d');
  });

  it('lets its own work be selected and moved', () => {
    runtime.tools.useById('wall');
    drag(point(0, 6), point(6, 6));
    runtime.tools.useById('select');

    const mine = session.doc
      .all()
      .filter(
        (e): e is WallEntity =>
          e instanceof WallEntity && !original.includes(e.id),
      )[0];
    session.selection.add(mine.id);
    drag(point(3, 6), point(3, 7));

    expect(mine.getBaseline().a.y).toBeCloseTo(7, 6);
  });

  it('still snaps new work to the plan it cannot edit', () => {
    // locked stays snappable on purpose: the whole point is drawing TO it
    runtime.tools.useById('wall');
    drag(point(6.05, 4.05), point(9, 4));
    runtime.tools.useById('select');

    const drawn = session.doc
      .all()
      .filter(
        (e): e is WallEntity =>
          e instanceof WallEntity && !original.includes(e.id),
      )[0];
    expect(drawn).toBeDefined();
  });
});

describe('closing the zone', () => {
  it('hides the work and hands the plan back', () => {
    enterDangerZone(session, runtime.ui);
    runtime.tools.useById('wall');
    drag(point(0, 6), point(6, 6));
    runtime.tools.useById('select');
    leaveDangerZone(session, runtime.ui);

    // the original is editable again
    drag(point(3, 0), point(3, 0));
    expect(session.selection.list()).toHaveLength(1);
  });

  it('leaves the hidden work out of a later resolve', () => {
    enterDangerZone(session, runtime.ui);
    runtime.tools.useById('wall');
    drag(point(3, -2), point(3, 6));
    runtime.tools.useById('select');
    leaveDangerZone(session, runtime.ui);
    const before = survey();

    // drawing over where the hidden wall runs must not notice it at all
    runtime.tools.useById('wall');
    drag(point(3, 5), point(9, 5));
    runtime.tools.useById('select');

    expect(survey()).toBe(before);
  });
});
