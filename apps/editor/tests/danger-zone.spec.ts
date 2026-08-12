import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  HostedOpeningEntity,
  WallEntity,
  buildDisplayList,
  isEntityInteractive,
  point,
} from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import {
  DANGER_ZONE_COLOR,
  dangerZoneLayer,
  enterDangerZone,
  isDangerZoneOn,
  leaveDangerZone,
  toggleDangerZone,
} from '@/editor/danger-zone';

/**
 * Danger zone: draw changes over a plan that is not yours to change. On, the
 * new work is red and the original is read-only; off, the new work is gone and
 * the original is editable again. Driven through the real tools, because the
 * whole point of the mode is what it does to every other tool.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;
/** the plan that was there first — drawn before the zone is ever opened */
let originalId: EntityId;

const down = (p: Point) =>
  runtime.tools.pointerDown({ point: p, modifiers: NO_MODS, snapped: false });
const move = (p: Point) =>
  runtime.tools.pointerMove({ point: p, modifiers: NO_MODS, snapped: false });
const up = (p: Point) =>
  runtime.tools.pointerUp({ point: p, modifiers: NO_MODS, snapped: false });

const drag = (from: Point, to: Point) => {
  down(from);
  move(to);
  up(to);
};

const tap = (p: Point) => {
  down(p);
  up(p);
};

/** draw a wall with the wall tool — the path a finger takes */
const drawWall = (from: Point, to: Point): WallEntity => {
  const before = new Set(walls().map((w) => w.id));
  runtime.tools.useById('wall');
  drag(from, to);
  runtime.tools.useById('select');
  const drawn = walls().find((w) => !before.has(w.id));
  expect(drawn).toBeDefined();
  return drawn!;
};

const walls = () =>
  session.doc.all().filter((e): e is WallEntity => e instanceof WallEntity);

const openings = () =>
  session.doc
    .all()
    .filter((e): e is HostedOpeningEntity => e instanceof HostedOpeningEntity);

const shown = () =>
  buildDisplayList(session.doc, { kind: 'plan', levelId: null });

const shownIds = () => shown().map((item) => item.entityId);

const strokeOf = (id: EntityId) =>
  shown().find((item) => item.entityId === id)?.style.stroke;

const baseline = (id: EntityId) =>
  (session.doc.get(id) as WallEntity).getBaseline();

const interactive = (id: EntityId) =>
  isEntityInteractive(session.doc, session.doc.get(id)!);

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.1;
  runtime.tools.useById('select');
  // one standalone wall, on the default layer, straight from the command bus:
  // this is "the original plan" every test below has to protect
  originalId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(6, 0),
    thickness: 0.3,
  });
});

describe('with the zone open', () => {
  beforeEach(() => {
    enterDangerZone(session, runtime.ui);
  });

  it('leaves the original plan drawn exactly as it was', () => {
    expect(shownIds()).toContain(originalId);
    expect(strokeOf(originalId)).not.toBe(DANGER_ZONE_COLOR);
  });

  it('hides nothing — there is no new work yet', () => {
    expect(shownIds()).toEqual([originalId]);
  });

  it('puts new walls on its own layer, in red', () => {
    const drawn = drawWall(point(0, 3), point(6, 3));

    const zone = dangerZoneLayer(session)!;
    expect(drawn.layerId).toBe(zone.id);
    expect(zone.color).toBe(DANGER_ZONE_COLOR);
    expect(strokeOf(drawn.id)).toBe(DANGER_ZONE_COLOR);
  });

  it('refuses to select the original plan', () => {
    expect(interactive(originalId)).toBe(false);

    tap(point(3, 0));

    expect(session.selection.list()).toEqual([]);
  });

  it('refuses to move the original plan', () => {
    const before = baseline(originalId);
    // selecting it is the only way to drag it, and that is the door that is
    // shut — try anyway, the way a finger would
    tap(point(3, 0));
    drag(point(3, 0), point(3, -2));

    expect(baseline(originalId)).toEqual(before);
  });

  it('still snaps new work to the original, locked or not', () => {
    // a change that cannot line up with what it is changing is useless
    expect(session.snap.snap(point(0, 0), 0.5)).not.toBeNull();
  });

  it('lets the new work be selected and moved like anything else', () => {
    const drawn = drawWall(point(0, 3), point(6, 3));

    tap(point(3, 3));
    expect(session.selection.list()).toEqual([drawn.id]);

    drag(point(3, 3), point(3, 4));
    expect(baseline(drawn.id).a.y).toBeCloseTo(4, 6);
  });

  it('places an opening on the zone layer, not the default one', () => {
    drawWall(point(0, 3), point(6, 3));

    runtime.tools.useById('window');
    drag(point(2, 3), point(4, 3));
    runtime.tools.useById('select');

    const window = openings()[0];
    expect(window).toBeDefined();
    expect(window.layerId).toBe(dangerZoneLayer(session)!.id);
    // the layer the original plan sits on is exactly where it must NOT land
    expect(window.layerId).not.toBe(session.doc.get(originalId)!.layerId);
  });

  it('takes the opening away with the rest of the zone work', () => {
    drawWall(point(0, 3), point(6, 3));
    runtime.tools.useById('window');
    drag(point(2, 3), point(4, 3));
    runtime.tools.useById('select');
    const window = openings()[0];

    leaveDangerZone(session, runtime.ui);

    expect(shownIds()).not.toContain(window.id);
  });
});

describe('with the zone closed again', () => {
  let zoneWallId: EntityId;

  beforeEach(() => {
    enterDangerZone(session, runtime.ui);
    zoneWallId = drawWall(point(0, 3), point(6, 3)).id;
    leaveDangerZone(session, runtime.ui);
  });

  it('takes the new work off the drawing', () => {
    expect(shownIds()).toEqual([originalId]);
    // hidden, not deleted — the next press has to find it where it was left
    expect(session.doc.get(zoneWallId)).not.toBeNull();
  });

  it('will not let the hidden work be selected', () => {
    tap(point(3, 3));

    expect(session.selection.list()).toEqual([]);
    expect(interactive(zoneWallId)).toBe(false);
  });

  it('hands the original plan back, editable', () => {
    expect(interactive(originalId)).toBe(true);

    tap(point(3, 0));
    expect(session.selection.list()).toEqual([originalId]);

    drag(point(3, 0), point(3, -2));
    expect(baseline(originalId).a.y).toBeCloseTo(-2, 6);
  });

  it('points new work back at the layer it was going to before', () => {
    expect(runtime.ui.activeLayerId.get()).toBeNull();
    const drawn = drawWall(point(0, 6), point(6, 6));
    expect(drawn.layerId).not.toBe(dangerZoneLayer(session)!.id);
    expect(shownIds()).toContain(drawn.id);
  });
});

/*
 * A mode change that takes four undos to walk back is a mode change nobody
 * trusts — however many layers had to be flipped to make it happen.
 */
describe('one undo each way', () => {
  it('walks the whole opening back in one step', () => {
    session.history.clear();
    enterDangerZone(session, runtime.ui);
    expect(session.history.canUndo).toBe(true);

    session.undo();

    expect(session.history.canUndo).toBe(false);
    expect(dangerZoneLayer(session)).toBeNull();
    expect(interactive(originalId)).toBe(true);
  });

  it('walks the whole closing back in one step', () => {
    enterDangerZone(session, runtime.ui);
    const zoneWallId = drawWall(point(0, 3), point(6, 3)).id;
    session.history.clear();

    leaveDangerZone(session, runtime.ui);
    expect(session.history.canUndo).toBe(true);

    session.undo();

    expect(session.history.canUndo).toBe(false);
    expect(shownIds()).toContain(zoneWallId);
  });
});

describe('toggling back and forth', () => {
  it('brings the same work back, and carries on from there', () => {
    const ui = runtime.ui;
    expect(isDangerZoneOn(ui)).toBe(false);

    toggleDangerZone(session, ui);
    const first = drawWall(point(0, 3), point(6, 3)).id;

    toggleDangerZone(session, ui);
    expect(isDangerZoneOn(ui)).toBe(false);
    expect(shownIds()).not.toContain(first);

    toggleDangerZone(session, ui);
    expect(isDangerZoneOn(ui)).toBe(true);
    expect(shownIds()).toContain(first);
    // and it is still editable: the mode picks up where it left off
    expect(interactive(first)).toBe(true);

    const second = drawWall(point(0, 5), point(6, 5)).id;
    expect(session.doc.get(second)!.layerId).toBe(dangerZoneLayer(session)!.id);
    // one layer, not a new one per visit
    expect(
      session.doc.layersList().filter((l) => l.color === DANGER_ZONE_COLOR),
    ).toHaveLength(1);
  });

  it('hands the original plan back and forth with it', () => {
    toggleDangerZone(session, runtime.ui);
    expect(interactive(originalId)).toBe(false);
    toggleDangerZone(session, runtime.ui);
    expect(interactive(originalId)).toBe(true);
  });

  // New wipes the document, layers and all, and the mode must not be left
  // holding a layer that no longer exists — the way out has to keep working
  it('closes cleanly after the document is replaced underneath it', () => {
    toggleDangerZone(session, runtime.ui);
    session.newDocument();

    expect(() => toggleDangerZone(session, runtime.ui)).not.toThrow();
    expect(isDangerZoneOn(runtime.ui)).toBe(false);
    expect(runtime.ui.activeLayerId.get()).toBeNull();
  });
});
