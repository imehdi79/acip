import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  point,
} from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { enterDangerZone, leaveDangerZone } from '@/editor/danger-zone';
import { duplicateSelection } from '@/app/components/layout/footer/duplicate';
import { planDimensions } from '@/editor/viewport/wall-dimensions';
import { alignGuides, planDragSnap } from '@/editor/tools/drafting';
import { resizeWallLength } from '@/editor/rooms';

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

/**
 * What the plan LOOKS like, as opposed to what it contains: the numbers
 * standing off it and the rooms shaded under it. Both are derived on read, and
 * both were once derived from entities the user could not see — a closed zone
 * left its dimensions hanging in empty space and its walls still cutting rooms
 * in two.
 */
const PLAN = { kind: 'plan' as const, levelId: null };
const drawn = () => ({
  dimensions: planDimensions(session.doc, PLAN)
    .map((d) => `${d.kind} ${d.length.toFixed(2)}`)
    .sort(),
  // the rooms as the plan view asks for them: shaded and labelled on screen
  rooms: detectSpaces(session.doc, null, { visibleOnly: true })
    .map((s) => s.netArea.toFixed(2))
    .sort(),
});

const drag = (from: Point, to: Point) => {
  runtime.tools.pointerDown({
    point: from,
    modifiers: NO_MODS,
    snapped: false,
  });
  runtime.tools.pointerMove({ point: to, modifiers: NO_MODS, snapped: false });
  runtime.tools.pointerUp({ point: to, modifiers: NO_MODS, snapped: false });
};

/** draw a wall with the wall tool, as a finger would */
const draw = (a: Point, b: Point) => {
  runtime.tools.useById('wall');
  drag(a, b);
  runtime.tools.useById('select');
};

/** the walls that are not part of the original plan — the zone's own work */
const zoneWalls = (): WallEntity[] =>
  session.doc
    .all()
    .filter(
      (e): e is WallEntity =>
        e instanceof WallEntity && !original.includes(e.id),
    );

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

  it('a wall of its own, welded to one of its corners, drags nothing', () => {
    // the tempting hole: the zone wall IS movable, shares a corner with the
    // original, and whole-wall moves carry welded neighbours so junctions hold.
    // Sharing a corner is not permission — the join gives way at the lock.
    draw(point(0, 0), point(0, -3));
    const mine = zoneWalls()[0];
    session.selection.add(mine.id);
    drag(point(0, -1.5), point(2, -1.5));

    expect(survey()).toBe(before);
  });

  it('a length typed into a zone wall does not stretch what it joins', () => {
    // corner to corner, so BOTH ends are joined to the plan: one end anchors
    // and the other MOVES, and it is the moving end that carries its corner
    // partners along. Those partners are the original.
    draw(point(0, 0), point(6, 4));
    const mine = zoneWalls()[0];
    resizeWallLength(
      (name, params) => session.dispatch(name, params),
      session.doc,
      mine.id,
      5,
    );

    expect(survey()).toBe(before);
    expect(mine.getLength()).toBeCloseTo(5, 6);
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

    const zone = zoneWalls();
    expect(zone.length).toBeGreaterThan(0);
    const layer = session.doc.getLayer(zone[0].layerId);
    expect(layer?.name).toBe('Danger zone');
    expect(layer?.color).toBe('#e5484d');
  });

  it('lets its own work be selected and moved', () => {
    draw(point(0, 6), point(6, 6));

    const mine = zoneWalls()[0];
    session.selection.add(mine.id);
    drag(point(3, 6), point(3, 7));

    expect(mine.getBaseline().a.y).toBeCloseTo(7, 6);
  });

  it('still snaps new work to the plan it cannot edit', () => {
    // locked stays snappable on purpose: the whole point is drawing TO it
    draw(point(6.05, 4.05), point(9, 4));

    expect(zoneWalls()[0]).toBeDefined();
  });

  /**
   * Drawing a new wall ALONG an existing one is the everyday mark-up: a wall
   * to be rebuilt, a partition to be thickened. The plan-wide "each stretch
   * of wall exists once" repair used to run across the lock and treat the new
   * line as the duplicate, so it was deleted the moment it was drawn.
   */
  describe('drawing over the plan itself', () => {
    it('keeps a wall drawn straight onto one of the plan’s own', () => {
      const plan = survey();
      draw(point(0, 0), point(6, 0)); // exactly over the original bottom wall

      const mine = zoneWalls();
      expect(mine).toHaveLength(1);
      expect(mine[0].getBaseline()).toEqual({ a: point(0, 0), b: point(6, 0) });
      expect(survey()).toBe(plan); // and the original is still whole
    });

    it('keeps one drawn along PART of one, in one piece', () => {
      const plan = survey();
      draw(point(3, 4), point(9, 4)); // half on the top wall, half past its end

      const mine = zoneWalls();
      expect(mine).toHaveLength(1);
      // not chopped at x=6 where the survey happens to stop
      expect(mine[0].getLength()).toBeCloseTo(6, 6);
      expect(survey()).toBe(plan);
    });

    it('keeps one drawn across the plan whole, and does not split the plan', () => {
      const plan = survey();
      draw(point(3, -2), point(3, 6));

      expect(zoneWalls()).toHaveLength(1);
      expect(survey()).toBe(plan);
    });

    it('does not re-cut the corners of the wall it is drawn over', () => {
      // a miter is MUTUAL: the overlay shares both endpoints with the plan, so
      // an ordinary join would have reshaped the plan's corners to fit it
      const bottom = session.doc.get(original[0]) as WallEntity;
      const corners = () =>
        bottom
          .getOutline()
          .map((p) => `${p.x.toFixed(3)},${p.y.toFixed(3)}`)
          .join(' ');
      const before = corners();

      draw(point(0, 0), point(6, 0));

      expect(corners()).toBe(before);
    });

    it('does not change the number printed under that wall', () => {
      const before = drawn().dimensions;
      draw(point(0, 0), point(6, 0));

      // the overlay keeps its own (shorter, uncornered) extent, but the label
      // on that run still measures the linework the user can see
      expect(drawn().dimensions).toEqual(before);
    });

    it('leaves the room under the overlay a single room', () => {
      draw(point(0, 0), point(6, 0));

      // a doubled wall must not read as a room of its own, however thin
      const rooms = detectSpaces(session.doc, null, { visibleOnly: true });
      expect(rooms).toHaveLength(1);
      expect(rooms[0].grossArea).toBeCloseTo(24, 6);
    });

    it('still offers the plan’s own corners to snap to', () => {
      // guidance is what makes drawing ONTO the plan practical, and locked
      // walls stay snappable: only hidden ones drop out
      const snap = session.snap.snap(point(0.05, 0.05), 0.3);
      expect(snap).not.toBeNull();
      expect(snap?.point).toEqual(point(0, 0));

      const guides = alignGuides(session.doc, point(6.05, 2), 0.3);
      expect(guides.guides.length).toBeGreaterThan(0);
      expect(guides.point.x).toBeCloseTo(6, 6);
    });

    it('lets the overlay be moved afterwards, and still keeps it', () => {
      const plan = survey();
      draw(point(0, 0), point(6, 0));
      const mine = zoneWalls()[0];
      session.selection.add(mine.id);
      drag(point(3, 0), point(3, 0.2));

      expect(zoneWalls()).toHaveLength(1);
      expect(session.doc.get(mine.id)).not.toBeNull();
      expect(survey()).toBe(plan);
    });
  });
});

describe('closing the zone', () => {
  it('hides the work and hands the plan back', () => {
    enterDangerZone(session, runtime.ui);
    draw(point(0, 6), point(6, 6));
    leaveDangerZone(session, runtime.ui);

    // the original is editable again
    drag(point(3, 0), point(3, 0));
    expect(session.selection.list()).toHaveLength(1);
  });

  it('leaves the hidden work out of a later resolve', () => {
    enterDangerZone(session, runtime.ui);
    draw(point(3, -2), point(3, 6));
    leaveDangerZone(session, runtime.ui);
    const before = survey();

    // drawing over where the hidden wall runs must not notice it at all
    draw(point(3, 5), point(9, 5));

    expect(survey()).toBe(before);
  });

  /**
   * The plan has to come back looking exactly as it did — not merely contain
   * the same walls. Every one of these was a way for invisible geometry to
   * keep showing: as a number, as a room, as a corner it changed the shape of,
   * or as something a finger still ran into.
   */
  describe('and leaving no trace of the work behind', () => {
    let before: ReturnType<typeof drawn>;

    beforeEach(() => {
      before = drawn();
      enterDangerZone(session, runtime.ui);
      // a partition across the room, and a second room hung off its corner
      draw(point(3, 0), point(3, 4));
      draw(point(0, 4), point(0, 8));
      draw(point(0, 8), point(6, 8));
      leaveDangerZone(session, runtime.ui);
    });

    it('prints no dimension for a wall that is not there', () => {
      expect(drawn().dimensions).toEqual(before.dimensions);
    });

    it('does not cut the room in two, or add one of its own', () => {
      expect(drawn().rooms).toEqual(before.rooms);
    });

    it('does not change the length of the walls it used to join', () => {
      // the partition tee'd into the top and bottom walls and a zone wall ran
      // off the left corner: while the zone was open those caps were mitered
      // to it, and closing has to give the plain wall back
      expect(drawn()).toEqual(before);
    });

    it('does not stick a drag to a corner nobody can see', () => {
      const plan = new Set(original.map((id) => id as string));
      // slide the whole plan so its corner lands a hair off a hidden node
      const snap = planDragSnap(session.doc, plan, { x: 0.05, y: 3.95 }, 0.2);

      expect(snap.delta).toEqual({ x: 0.05, y: 3.95 });
      expect(snap.guides).toEqual([]);
    });

    it('does not follow when a corner of the plan is dragged', () => {
      const hidden = zoneWalls().map((w) => ({
        id: w.id,
        at: JSON.stringify(w.getBaseline()),
      }));

      drag(point(0, 4), point(-1, 5));

      for (const { id, at } of hidden) {
        const wall = session.doc.get(id) as WallEntity;
        expect(JSON.stringify(wall.getBaseline())).toBe(at);
      }
    });

    it('comes back untouched when the zone opens again', () => {
      const hidden = zoneWalls()
        .map((w) => JSON.stringify(w.getBaseline()))
        .sort();
      enterDangerZone(session, runtime.ui);

      expect(
        zoneWalls()
          .map((w) => JSON.stringify(w.getBaseline()))
          .sort(),
      ).toEqual(hidden);
      expect(
        detectSpaces(session.doc, null, { visibleOnly: true }).length,
      ).toBeGreaterThan(before.rooms.length);
    });
  });
});
