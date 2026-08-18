import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, MaterialId } from '@acip/editor-core';
import { assembleBoq } from '@acip/estimator';
import { STARTER_MATERIALS, seedMaterials } from '@/data/materials';
import {
  anchorForSide,
  anchorForSurface,
  finishTargetFor,
  finishesAt,
  finishesOnFace,
  spotsFor,
  spotsToWrite,
} from '@/app/components/layout/footer/estimator-finishes';
import { estimatorSteps } from '@/app/components/layout/footer/estimator-steps';

/**
 * The sheet stopped keeping its own list and started reading the drawing, so
 * what is worth testing is the ROUND TRIP: write through the command core
 * publishes, read back through the app's own reader, and check the two agree —
 * about which face it landed on, about the order, and about the number.
 */

/** a four-wall room, seeded, with the walls handed back */
function plan(): { session: EditorSession; walls: EntityId[] } {
  const session = new EditorSession();
  seedMaterials(session);
  const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
  const walls = corners.map((a, i) =>
    session.dispatch<EntityId>('WALL.ADD', {
      a,
      b: corners[(i + 1) % corners.length],
      thickness: 0.3,
      height: 3,
    }),
  );
  return { session, walls };
}

/** the seeded material with this cost code */
function material(session: EditorSession, costCode: string): MaterialId {
  const found = session.doc.materials
    .list()
    .find((m) => m.costCode === costCode);
  if (!found) throw new Error(`no seeded material for ${costCode}`);
  return found.id;
}

describe('the starter material catalogue', () => {
  it('gives a generated plan something to build up from', () => {
    // a template plan starts from a bare EditorSession, whose material library
    // is empty; without the seed the add sheet opens onto nothing at all
    const session = new EditorSession();
    expect(session.doc.materials.list()).toHaveLength(0);
    seedMaterials(session);
    expect(session.doc.materials.list()).toHaveLength(STARTER_MATERIALS.length);
  });

  it('leaves a drawing that brought its own alone', () => {
    // a document loaded from a file carries the office's materials, with ids
    // that finishes already reference — a second "Plaster" beside them would
    // split one trade across two cost lines
    const { session } = plan();
    const before = session.doc.materials.list().length;
    expect(seedMaterials(session)).toEqual([]);
    expect(session.doc.materials.list()).toHaveLength(before);
  });

  it('carries a cost code for every material it seeds', () => {
    // the cost code is the whole seam: it is what a rate table is keyed by, so
    // a material without one is a line the bill can never price by name
    for (const material of STARTER_MATERIALS) {
      expect(material.costCode.trim()).toBeTruthy();
      expect(material.name.trim()).toBeTruthy();
    }
    // and the one `count` material carries its tile size, or the tile count
    // silently falls back to one unit per m²
    const tile = STARTER_MATERIALS.find((m) => m.unit === 'count');
    expect(tile?.coverage).toBeGreaterThan(0);
  });
});

describe('reading the finishes on a face', () => {
  it('finds what FINISH.ADD wrote, on the face it was written to', () => {
    // The reason this test exists: `anchorForSide` is COPIED out of core's
    // commands/finishes.ts, which does not export it. Writing through the
    // command and reading back through the copy is what stops the two drifting
    // — get the anchor wrong and every layer lands on the invisible face.
    const { session, walls } = plan();
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'plaster'),
    });

    const front = finishesOnFace(session.doc, walls[0], 'face+');
    const back = finishesOnFace(session.doc, walls[0], 'face-');
    expect(front).toHaveLength(1);
    expect(front[0].name).toBe('Plaster');
    expect(back).toEqual([]);
  });

  it('keeps the two faces apart', () => {
    const { session, walls } = plan();
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'plaster'),
    });
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face-',
      materialId: material(session, 'wall-tile'),
    });
    expect(
      finishesOnFace(session.doc, walls[0], 'face+').map((r) => r.name),
    ).toEqual(['Plaster']);
    expect(
      finishesOnFace(session.doc, walls[0], 'face-').map((r) => r.name),
    ).toEqual(['Wall tile']);
  });

  it('anchors face+ and face- apart, whatever the numbers are', () => {
    expect(anchorForSide('face+')).not.toBe(anchorForSide('face-'));
  });

  it('lists them in the order they went on', () => {
    // the number on each row is creation order and claims nothing more — a
    // finish carries no rank of its own for it to describe
    const { session, walls } = plan();
    for (const code of ['plaster', 'paint', 'wall-tile']) {
      session.dispatch('FINISH.ADD', {
        wallId: walls[0],
        side: 'face+',
        materialId: material(session, code),
      });
    }
    expect(
      finishesOnFace(session.doc, walls[0], 'face+').map((r) => r.costCode),
    ).toEqual(['plaster', 'paint', 'wall-tile']);
  });

  it('reads nothing off a face nobody has touched', () => {
    const { session, walls } = plan();
    expect(finishesOnFace(session.doc, walls[1], 'face+')).toEqual([]);
  });

  it('drops a row when the finish is erased', () => {
    const { session, walls } = plan();
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'paint'),
    });
    expect(finishesOnFace(session.doc, walls[0], 'face+')).toHaveLength(1);
    session.dispatch('ENTITY.ERASE', { ids: [id] });
    expect(finishesOnFace(session.doc, walls[0], 'face+')).toEqual([]);
  });

  it('takes the openings out of the area, like the bill does', () => {
    // a wall with a window in it is the single most common place an estimate
    // goes wrong by the area of the window
    const { session, walls } = plan();
    const materialId = material(session, 'paint');
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId,
    });
    const solid = finishesOnFace(session.doc, walls[0], 'face+')[0].area;

    session.dispatch('WINDOW.ADD', { wallId: walls[0], t: 0.5 });
    const cut = finishesOnFace(session.doc, walls[0], 'face+')[0].area;
    expect(cut).toBeLessThan(solid);
  });

  /*
   * The sheet is a view onto the estimate. A face that reads 12.4 m² here and
   * 11.9 m² in the bill is worse than a face that reads nothing at all, so the
   * quantity is checked against the BOQ's own line rather than against a number
   * written down in this file.
   */
  it('shows the same quantity the bill of quantities will carry', () => {
    const { session, walls } = plan();
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'wall-tile'),
    });

    const row = finishesOnFace(session.doc, walls[0], 'face+')[0];
    const line = assembleBoq(session.doc).lines.find(
      (l) => l.costCode === 'wall-tile',
    );
    expect(line).toBeDefined();
    expect(row.quantity).toBeCloseTo(line?.quantity ?? -1, 6);
    // and in the material's own unit — a tiled face is priced in TILES, worked
    // out from the area and the tile size
    expect(row.unit).toBe('count');
    expect(row.quantity).toBeGreaterThan(row.area);
  });

  it('prices a strip-out as area against a demo code', () => {
    // demolition is a finish in reverse: you do not count the tiles you are
    // tearing off a wall
    const { session, walls } = plan();
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'wall-tile'),
      phase: 'demolish',
    });
    const row = finishesOnFace(session.doc, walls[0], 'face+')[0];
    expect(row.costCode).toBe('demo-wall-tile');
    expect(row.unit).toBe('m2');
    expect(row.quantity).toBeCloseTo(row.area, 6);
  });
});

/**
 * A session's dispatch as a plain function.
 *
 * `session.dispatch` handed over bare arrives with no `this` and throws on the
 * command bus — the same trap the sheet itself has to avoid, which is exactly
 * why the tests dispatch the way the sheet does.
 */
function dispatcher(session: EditorSession) {
  return <R>(name: string, params: unknown): R =>
    session.dispatch<R>(name, params);
}

/** the walk's room step, which four walls always enclose */
function roomStep(session: EditorSession) {
  const room = estimatorSteps(session.doc, null).find((s) => s.kind === 'room');
  if (!room) throw new Error('the four walls enclosed no room');
  return room;
}

/** how many slabs the drawing carries, to catch one being laid or lost */
function slabCount(session: EditorSession): number {
  return [...session.doc.all()].filter((e) => e.type === 'slab').length;
}

/** lay a floor or ceiling layer on a room the way the sheet's Save does */
function addRoomLayer(
  session: EditorSession,
  side: 'floor' | 'ceiling',
  costCode: string,
): void {
  const spots = spotsToWrite(
    session.doc,
    finishTargetFor(session.doc, roomStep(session)),
    dispatcher(session),
  );
  const spot = spots[side];
  if (!spot || spot.kind !== 'slab') throw new Error(`no ${side} to write to`);
  session.dispatch('FLOORFINISH.ADD', {
    slabId: spot.slabId,
    surface: spot.surface,
    materialId: material(session, costCode),
  });
}

describe('pricing a room through its slab', () => {
  it('puts a floor layer on the floor and not on the ceiling', () => {
    // The round trip that keeps the anchor mapping honest. A slab's anchors
    // are NOT the wall's: anchor 1 is a wall's face+ AND a slab's underside,
    // so reading the wrong table lands a screed on a ceiling, silently.
    const { session } = plan();
    addRoomLayer(session, 'floor', 'screed');

    const spots = spotsFor(finishTargetFor(session.doc, roomStep(session)));
    const floor = spots.floor;
    const ceiling = spots.ceiling;
    if (!floor || !ceiling) throw new Error('the room has no surfaces');
    expect(finishesAt(session.doc, floor).map((r) => r.costCode)).toEqual([
      'screed',
    ]);
    expect(finishesAt(session.doc, ceiling)).toEqual([]);
  });

  it('keeps the floor and the ceiling apart', () => {
    const { session } = plan();
    addRoomLayer(session, 'floor', 'floor-tile');
    addRoomLayer(session, 'ceiling', 'paint');

    const spots = spotsFor(finishTargetFor(session.doc, roomStep(session)));
    expect(
      finishesAt(session.doc, spots.floor!).map((r) => r.costCode),
    ).toEqual(['floor-tile']);
    expect(
      finishesAt(session.doc, spots.ceiling!).map((r) => r.costCode),
    ).toEqual(['paint']);
  });

  /*
   * The hazard the whole design is shaped around. SLAB.AUTO regenerates: it
   * removes every slab it previously made and rebuilds them, and a removed
   * slab takes its hosted finishes with it. So the obvious way to give a room
   * a floor is also the one command that would wipe every build-up the user
   * had entered. This proves the scheme actually used never does that.
   */
  it('never destroys a build-up by asking for a floor again', () => {
    const { session } = plan();
    addRoomLayer(session, 'floor', 'screed');
    addRoomLayer(session, 'floor', 'floor-tile');

    const before = finishesAt(
      session.doc,
      spotsFor(finishTargetFor(session.doc, roomStep(session))).floor!,
    ).map((r) => r.costCode);
    expect(before).toEqual(['screed', 'floor-tile']);

    // ask again, repeatedly, exactly as reopening the sheet and saving would
    for (let i = 0; i < 3; i += 1) {
      spotsToWrite(
        session.doc,
        finishTargetFor(session.doc, roomStep(session)),
        dispatcher(session),
      );
    }
    expect(slabCount(session)).toBe(1);
    expect(
      finishesAt(
        session.doc,
        spotsFor(finishTargetFor(session.doc, roomStep(session))).floor!,
      ).map((r) => r.costCode),
    ).toEqual(before);
  });

  it('survives a SLAB.AUTO run from anywhere else', () => {
    // the slab is laid hand-placed (auto = false) on purpose, and SLAB.AUTO
    // never touches those — marking it auto would have looked more honest and
    // handed the regenerate macro a licence to delete the user's work
    const { session } = plan();
    addRoomLayer(session, 'floor', 'screed');
    session.dispatch('SLAB.AUTO', {});
    expect(
      finishesAt(
        session.doc,
        spotsFor(finishTargetFor(session.doc, roomStep(session))).floor!,
      ).map((r) => r.costCode),
    ).toEqual(['screed']);
  });

  it('walks the room, never the slab under it', () => {
    // the same screed asked for twice — once under "Room — Kitchen" and once
    // under "Slab SL1" — with the second naming a shape nobody drew
    const { session } = plan();
    addRoomLayer(session, 'floor', 'screed');
    const kinds = estimatorSteps(session.doc, null).map((s) => s.kind);
    expect(kinds).toContain('room');
    expect(kinds).not.toContain('slab');
  });
});

describe('where a step can put a build-up', () => {
  it('sends a wall step to its wall', () => {
    const { session, walls } = plan();
    const steps = estimatorSteps(session.doc, null);
    const wallStep = steps.find((s) => s.kind === 'wall');
    if (!wallStep) throw new Error('the walk turned up no wall');
    const target = finishTargetFor(session.doc, wallStep);
    expect(target.kind).toBe('wall');
    expect(walls).toContain(target.kind === 'wall' ? target.wallId : undefined);
  });

  it('sends a room to the slab under it, laying one only when asked', () => {
    // Nothing is created by LOOKING. A slab is a real entity that draws in the
    // plan, prices as concrete and lands in the undo stack, so walking past a
    // room must not leave one behind — it appears when the user says what the
    // floor is built up from.
    const { session } = plan();
    const room = roomStep(session);
    expect(finishTargetFor(session.doc, room).kind).toBe('room');
    expect(slabCount(session)).toBe(0);

    const spots = spotsToWrite(
      session.doc,
      finishTargetFor(session.doc, room),
      dispatcher(session),
    );
    expect(slabCount(session)).toBe(1);
    expect(spots.floor?.kind).toBe('slab');
    // and now that one is there, looking finds it rather than laying a second
    expect(finishTargetFor(session.doc, room).kind).toBe('slab');
    spotsToWrite(
      session.doc,
      finishTargetFor(session.doc, room),
      session.dispatch,
    );
    expect(slabCount(session)).toBe(1);
  });

  it('says why an opening cannot take one', () => {
    const { session, walls } = plan();
    session.dispatch('WINDOW.ADD', { wallId: walls[0], t: 0.5 });
    const window = estimatorSteps(session.doc, null).find(
      (s) => s.kind === 'window',
    );
    if (!window) throw new Error('the window was not walked');
    const target = finishTargetFor(session.doc, window);
    expect(target.kind).toBe('none');
    // and it names the thing, rather than saying "not supported"
    expect(target.kind === 'none' && target.reason).toMatch(/window/i);
  });
});

describe('what the walk counts as a shape', () => {
  it('does not walk the finishes it just wrote', () => {
    /*
     * A finish is a layer of some wall face's build-up, and the estimator
     * writes them itself now. Left in the walk, every plaster the user added
     * would come back as its own step next time — asking them to build up a
     * build-up, and growing the walk by a step every time they priced a face.
     */
    const { session, walls } = plan();
    const before = estimatorSteps(session.doc, null).length;
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'plaster'),
    });
    const after = estimatorSteps(session.doc, null);
    expect(after).toHaveLength(before);
    expect(after.some((s) => s.kind === 'finish')).toBe(false);
  });
});

/**
 * Phase two: the band is editable, so the numbers behind a row can be made to
 * describe what is actually being built. The round trip is the point — an edit
 * dispatched the way the sheet dispatches it, read back through the reader the
 * sheet reads through.
 */
describe('editing a band', () => {
  /** a wall with one painted face, and that face's single row */
  function painted() {
    const { session, walls } = plan();
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'paint'),
    });
    const read = () => finishesOnFace(session.doc, walls[0], 'face+')[0];
    return { session, walls, read };
  }

  it('carries the band the sheet edits, on a wall face', () => {
    const row = painted().read();
    // a fresh finish runs the whole face: floor to full height, end to end
    expect(row.band).toEqual({
      sillHeight: 0,
      topHeight: null,
      t0: 0,
      t1: 1,
    });
  });

  it('shrinks the area when the band shrinks', () => {
    // the whole reason the band is editable: "tile to 1.2 m" is a different
    // quantity from "tile the wall", and it was unsayable before
    const { session, read } = painted();
    const whole = read().area;
    session.dispatch('FINISH.UPDATE', { id: read().id, topHeight: 1.2 });
    const dado = read();
    expect(dado.band?.topHeight).toBe(1.2);
    expect(dado.area).toBeLessThan(whole);
    // and the quantity follows the area, because it is derived from it
    expect(dado.quantity).toBeCloseTo(dado.area, 9);
  });

  it('keeps the id and the place in the stack', () => {
    // the defect that made erase-and-re-add unacceptable: editing layer 1
    // would have moved it to the bottom
    const { session, walls } = plan();
    for (const code of ['plaster', 'paint']) {
      session.dispatch('FINISH.ADD', {
        wallId: walls[0],
        side: 'face+',
        materialId: material(session, code),
      });
    }
    const before = finishesOnFace(session.doc, walls[0], 'face+');
    session.dispatch('FINISH.UPDATE', { id: before[0].id, sillHeight: 0.1 });
    const after = finishesOnFace(session.doc, walls[0], 'face+');
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0].band?.sillHeight).toBe(0.1);
  });

  it('sends the band back to the top of the wall', () => {
    const { session, read } = painted();
    session.dispatch('FINISH.UPDATE', { id: read().id, topHeight: 1.2 });
    expect(read().band?.topHeight).toBe(1.2);
    // the state no number can stand for, which is why it has its own flag
    session.dispatch('FINISH.UPDATE', { id: read().id, fullHeight: true });
    expect(read().band?.topHeight).toBeNull();
  });

  it('narrows the extent along the wall', () => {
    const { session, read } = painted();
    const whole = read().length;
    session.dispatch('FINISH.UPDATE', { id: read().id, t0: 0.25, t1: 0.75 });
    const half = read();
    expect(half.band?.t0).toBe(0.25);
    expect(half.length).toBeCloseTo(whole / 2, 6);
  });

  it('has no band to edit on a floor, and core refuses one', () => {
    // a slab finish IS the whole footprint; the null is what stops the sheet
    // offering an input whose save could only ever throw
    const { session } = plan();
    addRoomLayer(session, 'floor', 'screed');
    const floor = finishesAt(
      session.doc,
      spotsFor(finishTargetFor(session.doc, roomStep(session))).floor!,
    )[0];
    expect(floor.band).toBeNull();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id: floor.id, topHeight: 1.2 }),
    ).toThrow();
  });

  it('moves a layer between building and stripping out', () => {
    // PHASE.SET, not FINISH.UPDATE: core kept the phase out of the update
    // command so one field would not have two writers
    const { session, read } = painted();
    expect(read().costCode).toBe('paint');
    session.dispatch('PHASE.SET', { ids: [read().id], phase: 'demolish' });
    const torn = read();
    expect(torn.phase).toBe('demolish');
    // priced as an area strip-out against its own code, at its own rate
    expect(torn.costCode).toBe('demo-paint');
    expect(torn.unit).toBe('m2');
  });

  it('still agrees with the bill after an edit', () => {
    const { session, read } = painted();
    session.dispatch('FINISH.UPDATE', {
      id: read().id,
      sillHeight: 0.1,
      topHeight: 1.3,
    });
    const row = read();
    const line = assembleBoq(session.doc).lines.find(
      (l) => l.costCode === 'paint',
    );
    expect(row.quantity).toBeCloseTo(line?.quantity ?? -1, 6);
  });
});
