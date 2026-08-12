import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, LayerId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { enterDangerZone } from '@/editor/danger-zone';
import {
  applyMeasurements,
  selectedWalls,
} from '@/app/components/layout/footer/measurements';

/**
 * Multi-select: the footer toggle that turns a tap from "select this" into
 * "add this as well", because a phone has no Shift to hold and some edits —
 * one thickness across six walls — need six walls selected at once.
 *
 * Driven through the real tool with real taps: the mode is only worth anything
 * if a finger can actually build a selection with it.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

const addWall = (a: Point, b: Point, layerId?: LayerId) =>
  session.dispatch<EntityId>('WALL.ADD', {
    a,
    b,
    thickness: 0.3,
    height: 3,
    ...(layerId ? { layerId } : {}),
  });

/** the four walls of a rectangular room, anticlockwise from the bottom */
const buildRoom = (x0: number, y0: number, x1: number, y1: number) => {
  const corners = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return corners.map((a, i) => addWall(a, corners[(i + 1) % corners.length]));
};

/** a tap: down and up in the same place, which is all a finger does */
const tap = (p: Point, mods = NO_MODS) => {
  runtime.tools.pointerDown({ point: p, modifiers: mods, snapped: false });
  runtime.tools.pointerUp({ point: p, modifiers: mods, snapped: false });
};

const selected = () => new Set(session.selection.list());

const baseline = (id: EntityId) =>
  (session.doc.get(id) as WallEntity).getBaseline();

/** the plan as text, so any change to it at all shows up */
const survey = (ids: readonly EntityId[]) =>
  ids
    .map((id) => {
      const wall = session.doc.get(id) as WallEntity | null;
      if (!wall) return `${id}: GONE`;
      const { a, b } = wall.getBaseline();
      return `${id}: ${a.x},${a.y}→${b.x},${b.y} t=${wall.getThickness()}`;
    })
    .join('\n');

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
  runtime.tools.useById('select');
});

describe('the default: a tap replaces the selection', () => {
  it('starts with the mode off', () => {
    expect(runtime.ui.multiSelect.get()).toBe(false);
  });

  it('drops the last wall when the next one is tapped', () => {
    const [bottom, right] = buildRoom(0, 0, 4, 4);
    tap(point(2, 0));
    tap(point(4, 2));

    expect(selected()).toEqual(new Set([right]));
    expect(session.selection.has(bottom)).toBe(false);
  });
});

describe('with multi-select on', () => {
  beforeEach(() => {
    runtime.ui.multiSelect.set(true);
  });

  it('gathers a wall with every tap', () => {
    const [bottom, right, top] = buildRoom(0, 0, 4, 4);

    tap(point(2, 0));
    tap(point(4, 2));
    tap(point(2, 4));

    expect(selected()).toEqual(new Set([bottom, right, top]));
  });

  // without this a mis-tap means starting the whole selection again, which on
  // a phone is the difference between usable and not
  it('takes a wall back out when it is tapped again', () => {
    const [, right] = buildRoom(0, 0, 4, 4);

    tap(point(2, 0));
    tap(point(4, 2));
    tap(point(2, 0));

    expect(selected()).toEqual(new Set([right]));
  });

  it('builds on a selection made before the mode was switched on', () => {
    const [bottom, right] = buildRoom(0, 0, 4, 4);
    runtime.ui.multiSelect.set(false);
    tap(point(2, 0));
    runtime.ui.multiSelect.set(true);

    tap(point(4, 2));

    expect(selected()).toEqual(new Set([bottom, right]));
  });

  // the whole point of gathering is what you do with it afterwards
  it('keeps everything gathered when the mode is switched off', () => {
    const [bottom, right] = buildRoom(0, 0, 4, 4);
    tap(point(2, 0));
    tap(point(4, 2));

    runtime.ui.multiSelect.set(false);

    expect(selected()).toEqual(new Set([bottom, right]));
  });

  it('does not lose the selection to a tap on empty ground', () => {
    const [bottom] = buildRoom(0, 0, 4, 4);
    tap(point(2, 0));

    tap(point(-5, -5));

    expect(selected()).toEqual(new Set([bottom]));
  });

  it('adds a whole room to what is already gathered', () => {
    const first = buildRoom(0, 0, 4, 4);
    const second = buildRoom(10, 0, 14, 4);

    tap(point(2, 2)); // inside the first room
    tap(point(12, 2)); // inside the second

    expect(selected()).toEqual(new Set([...first, ...second]));
  });

  /*
   * Everything gathered shows its grips, and those grips sit on the very
   * corners where the next wall to gather meets the last one. A fingertip is
   * wider than that gap, so if grips still won, reaching for one more wall
   * would stretch the wall you already had.
   */
  it('gathers the neighbour at a shared corner instead of stretching', () => {
    const ids = buildRoom(0, 0, 4, 4);
    const before = survey(ids);
    tap(point(2, 0));

    tap(point(4, 0)); // the corner the bottom and right walls share

    expect(session.selection.size).toBe(2);
    expect(survey(ids)).toBe(before);
  });

  it('leaves the plan alone even where a tap wanders', () => {
    const ids = buildRoom(0, 0, 4, 4);
    const before = survey(ids);
    tap(point(2, 0));

    // a thumb that slides while gathering must not carry the selection off
    runtime.tools.pointerDown({
      point: point(2, 0),
      modifiers: NO_MODS,
      snapped: false,
    });
    runtime.tools.pointerMove({
      point: point(2, 3),
      modifiers: NO_MODS,
      snapped: false,
    });
    runtime.tools.pointerUp({
      point: point(2, 3),
      modifiers: NO_MODS,
      snapped: false,
    });

    expect(survey(ids)).toBe(before);
    expect(baseline(ids[0])).toEqual({ a: point(0, 0), b: point(4, 0) });
  });

  // one thickness across six walls is the reason the mode exists
  it('hands the whole gathered set to the measurements dialog', () => {
    const ids = buildRoom(0, 0, 4, 4);
    tap(point(2, 0));
    tap(point(4, 2));
    tap(point(2, 4));

    const walls = selectedWalls(session);
    expect(walls).toHaveLength(3);
    expect(
      applyMeasurements(session, walls, {
        length: '',
        height: '2.4',
        thickness: '0.2',
      }),
    ).toEqual([]);

    for (const id of ids.slice(0, 3)) {
      const wall = session.doc.get(id) as WallEntity;
      expect(wall.getHeight()).toBeCloseTo(2.4);
      expect(wall.getThickness()).toBeCloseTo(0.2);
    }
    // the wall nobody tapped kept its own dimensions
    const untouched = session.doc.get(ids[3]) as WallEntity;
    expect(untouched.getHeight()).toBeCloseTo(3);
    expect(untouched.getThickness()).toBeCloseTo(0.3);
  });

  it('is still one undo for the lot', () => {
    const ids = buildRoom(0, 0, 4, 4);
    tap(point(2, 0));
    tap(point(4, 2));

    applyMeasurements(session, selectedWalls(session), {
      length: '',
      height: '2.4',
      thickness: '0.2',
    });
    session.undo();

    for (const id of ids) {
      expect((session.doc.get(id) as WallEntity).getHeight()).toBeCloseTo(3);
    }
  });
});

/**
 * A room is derived geometry, not an entity, so it carries no lock of its own —
 * which is how tapping in the middle of one used to hand back walls the user
 * was not allowed to touch. With multi-select on, taps accumulate: a few taps
 * inside rooms would have gathered a locked plan quietly, and every button in
 * the selection run would then have gone through the lock.
 */
describe('a tap inside a room respects the lock on its walls', () => {
  it('selects nothing inside a room the danger zone has locked', () => {
    buildRoom(0, 0, 6, 4);
    enterDangerZone(session, runtime.ui);

    tap(point(3, 2)); // dead centre, on no wall

    expect(session.selection.list()).toEqual([]);
  });

  it('leaves the original plan whole when Delete follows that tap', () => {
    const ids = buildRoom(0, 0, 6, 4);
    enterDangerZone(session, runtime.ui);
    const before = survey(ids);

    tap(point(3, 2));
    session.dispatch('ENTITY.ERASE', { ids: session.selection.list() });

    expect(survey(ids)).toBe(before);
  });

  it('gathers nothing from it however many taps land inside', () => {
    const first = buildRoom(0, 0, 6, 4);
    const second = buildRoom(10, 0, 16, 4);
    enterDangerZone(session, runtime.ui);
    runtime.ui.multiSelect.set(true);
    const before = survey([...first, ...second]);

    tap(point(3, 2));
    tap(point(13, 2));
    tap(point(3, 2));

    expect(session.selection.list()).toEqual([]);
    session.dispatch('ENTITY.ERASE', { ids: session.selection.list() });
    expect(survey([...first, ...second])).toBe(before);
  });

  /*
   * A part-locked room hands back the walls you may actually edit and nothing
   * else. That is honest: the rect-room detector will then not see a room, and
   * it is right not to — a room three quarters of which is untouchable is not
   * a room anyone can resize.
   */
  it('hands back only the walls that are not locked', () => {
    const mine = session.dispatch<LayerId>('LAYER.ADD', { name: 'Mine' });
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    const ids = corners.map((a, i) =>
      addWall(a, corners[(i + 1) % corners.length], i === 0 ? mine : undefined),
    );
    for (const layer of session.doc.layersList()) {
      if (layer.id !== mine)
        session.dispatch('LAYER.UPDATE', { id: layer.id, locked: true });
    }

    tap(point(3, 2));

    expect(session.selection.list()).toEqual([ids[0]]);
  });
});
