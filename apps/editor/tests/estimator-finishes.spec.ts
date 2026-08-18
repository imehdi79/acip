import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, MaterialId } from '@acip/editor-core';
import { assembleBoq } from '@acip/estimator';
import { STARTER_MATERIALS, seedMaterials } from '@/data/materials';
import {
  anchorForSide,
  anchorForSurface,
  coverPatch,
  finishTargetFor,
  finishesAt,
  finishesOnFace,
  spotsFor,
  spotsToWrite,
  type FinishCover,
} from '@/app/components/layout/footer/estimator-finishes';
import { estimatorSteps } from '@/app/components/layout/footer/estimator-steps';
import { reviewSteps } from '@/app/components/layout/footer/estimator-review';

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
 * The sheet states an extent as a WIDTH and a HEIGHT in metres, because that
 * is what an estimator measures. The document holds a wall band as parameters
 * along a baseline and a floor as an unanchored rectangle; `coverPatch` is the
 * one place either is written, so it is the one place worth testing.
 */
describe('editing what a layer covers', () => {
  /** a 6 m wall with one painted face, and that face's single row */
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

  /** dispatch a cover edit the way the sheet does */
  function setCover(
    session: EditorSession,
    row: { id: EntityId; cover: FinishCover | null },
    next: { width?: number; height?: number },
  ) {
    if (!row.cover) throw new Error('nothing to cover');
    session.dispatch('FINISH.UPDATE', {
      id: row.id,
      ...coverPatch(row.cover, next),
    });
  }

  it('measures a fresh wall finish as the whole face', () => {
    const row = painted().read();
    expect(row.cover?.host).toBe('wall');
    // the wall is 6 m long and 3 m high; a new finish covers all of it
    expect(row.cover?.width).toBeCloseTo(6, 6);
    expect(row.cover?.height).toBeCloseTo(3, 6);
  });

  it('narrows the face to the width it is given', () => {
    const { session, read } = painted();
    setCover(session, read(), { width: 3 });
    const half = read();
    expect(half.cover?.width).toBeCloseTo(3, 6);
    // and the area follows, because it is derived from the band
    expect(half.area).toBeCloseTo(3 * 3, 6);
  });

  it('lowers the face to the height it is given', () => {
    // "tile to 1.2 m" — the thing the sheet existed to be unable to say
    const { session, read } = painted();
    setCover(session, read(), { height: 1.2 });
    const dado = read();
    expect(dado.cover?.height).toBeCloseTo(1.2, 6);
    expect(dado.area).toBeCloseTo(6 * 1.2, 6);
  });

  it('measures from where the band starts, not from the middle', () => {
    // an estimator typing 1.2 m over a dado means 1.2 m up from where it
    // begins; moving the foot of a band they did not touch would be an edit
    // they never asked for
    const { session, read } = painted();
    session.dispatch('FINISH.UPDATE', { id: read().id, sillHeight: 0.5 });
    setCover(session, read(), { height: 1 });
    expect(read().cover?.height).toBeCloseTo(1, 6);
    expect(read().area).toBeCloseTo(6 * 1, 6);
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
    setCover(session, before[0], { height: 1.2 });
    const after = finishesOnFace(session.doc, walls[0], 'face+');
    expect(after.map((r) => r.id)).toEqual(before.map((r) => r.id));
    expect(after[0].cover?.height).toBeCloseTo(1.2, 6);
  });

  it('takes the openings out, or does not, per layer', () => {
    // the two conventions coexist in one estimate: the blockwork behind a
    // window may be measured solid while the paint over it is not
    const { session, walls, read } = painted();
    session.dispatch('WINDOW.ADD', { wallId: walls[0], t: 0.5 });
    const net = read();
    expect(net.deductOpenings).toBe(true);
    expect(net.area).toBeLessThan(6 * 3);

    session.dispatch('FINISH.UPDATE', {
      id: net.id,
      deductOpenings: false,
    });
    const solid = read();
    expect(solid.deductOpenings).toBe(false);
    expect(solid.area).toBeCloseTo(6 * 3, 6);
  });

  it('covers a floor with a rectangle, in the same words', () => {
    // a slab has no band to anchor against, so the same width and height are
    // written as an unanchored covered rectangle instead — which is exactly
    // what the sheet never has to know
    const { session } = plan();
    addRoomLayer(session, 'floor', 'floor-tile');
    const floorSpot = () =>
      spotsFor(finishTargetFor(session.doc, roomStep(session))).floor!;
    const before = finishesAt(session.doc, floorSpot())[0];
    expect(before.cover?.host).toBe('slab');

    setCover(session, before, { width: 3, height: 2 });
    const after = finishesAt(session.doc, floorSpot())[0];
    expect(after.area).toBeCloseTo(6, 6);
    expect(after.cover?.width).toBeCloseTo(3, 6);
  });

  it('sends both halves of a floor rectangle, because core needs both', () => {
    // one dimension alone cannot say what area is covered, and core refuses
    // half a rectangle rather than defaulting the other side
    const cover = {
      width: 6,
      height: 4,
      host: 'slab' as const,
      t0: 0,
      sillHeight: 0,
      hostLength: 0,
    };
    expect(coverPatch(cover, { width: 3 })).toEqual({
      coverWidth: 3,
      coverHeight: 4,
    });
  });

  it('still agrees with the bill after an edit', () => {
    const { session, read } = painted();
    setCover(session, read(), { height: 1.3 });
    const row = read();
    const line = assembleBoq(session.doc).lines.find(
      (l) => l.costCode === 'paint',
    );
    expect(row.quantity).toBeCloseTo(line?.quantity ?? -1, 6);
  });
});

/**
 * The end of the walk reads the whole drawing back. Its value is the shapes
 * nobody put anything on — a wall you walked past without noticing shows up
 * only as a row saying nothing is on it.
 */
describe('reading the estimate back', () => {
  it('lists every shape, priced or not', () => {
    const { session, walls } = plan();
    session.dispatch('FINISH.ADD', {
      wallId: walls[0],
      side: 'face+',
      materialId: material(session, 'paint'),
    });
    const steps = estimatorSteps(session.doc, null);
    const review = reviewSteps(session.doc, steps);

    expect(review).toHaveLength(steps.length);
    // the one that was priced, and the three that were not
    expect(review.filter((s) => s.layers > 0)).toHaveLength(1);
    expect(review.filter((s) => s.layers === 0).length).toBeGreaterThan(0);
  });

  it('counts the layers on both surfaces of a shape', () => {
    const { session, walls } = plan();
    for (const side of ['face+', 'face-']) {
      session.dispatch('FINISH.ADD', {
        wallId: walls[0],
        side,
        materialId: material(session, 'paint'),
      });
    }
    const review = reviewSteps(session.doc, estimatorSteps(session.doc, null));
    const wall = review.find((s) => s.layers > 0);
    expect(wall?.layers).toBe(2);
    expect(wall?.surfaces.filter((f) => f.rows.length > 0)).toHaveLength(2);
  });

  it('never lays a slab just by being read', () => {
    // the summary goes through spotsFor, the half of the table that cannot
    // change the drawing — opening it must not floor every room in the plan
    const { session } = plan();
    const before = slabCount(session);
    reviewSteps(session.doc, estimatorSteps(session.doc, null));
    expect(slabCount(session)).toBe(before);
    expect(before).toBe(0);
  });

  it('shows a room that has been floored', () => {
    const { session } = plan();
    addRoomLayer(session, 'floor', 'screed');
    const review = reviewSteps(session.doc, estimatorSteps(session.doc, null));
    const room = review.find((s) => s.name.startsWith('Room'));
    expect(room?.layers).toBe(1);
    expect(room?.surfaces.find((f) => f.rows.length > 0)?.label).toBe('Floor');
  });
});
