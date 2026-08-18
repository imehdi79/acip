import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  FinishEntity,
  computeQuantities,
  detectSpaces,
  point,
} from '../src/index.js';
import type { EntityId, MaterialId, Point } from '../src/index.js';

function addWall(
  session: EditorSession,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): EntityId {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });
}

function tileMaterial(session: EditorSession): MaterialId {
  return session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Wall tile',
    unit: 'count',
    costCode: 'wall-tile',
    coverage: 0.09,
  });
}

function drawRoom(session: EditorSession): EntityId[] {
  return [
    addWall(session, 0, 0, 6, 0),
    addWall(session, 6, 0, 6, 4),
    addWall(session, 6, 4, 0, 4),
    addWall(session, 0, 4, 0, 0),
  ];
}

describe('FinishEntity — a material on a wall face', () => {
  test('full-wall finish nets the whole face area; follows the wall', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const paint = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Paint',
      unit: 'm2',
      costCode: 'paint',
    });
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: paint,
    });
    const finish = session.doc.get(id) as FinishEntity;
    expect(finish).toBeInstanceOf(FinishEntity);
    expect(finish.getSide()).toBe('face+');
    expect(finish.getNetArea()).toBeCloseTo(30, 9); // 10 × 3

    // stretch the wall — the finished area follows
    session.dispatch('GRIP.MOVE', { id: wallId, index: 1, to: point(12, 0) });
    expect(finish.getNetArea()).toBeCloseTo(36, 9); // 12 × 3
  });

  test('a wainscot band and overlapping openings subtract from the area', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const tile = tileMaterial(session);
    // tile up to 1.2 m only
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tile,
      topHeight: 1.2,
    });
    const finish = session.doc.get(id) as FinishEntity;
    expect(finish.getNetArea()).toBeCloseTo(12, 9); // 10 × 1.2

    // a door (sill 0, height 2.1) overlaps the 0–1.2 band by 0.9 × 1.2
    session.dispatch('DOOR.ADD', { wallId, t: 0.5, width: 0.9, height: 2.1 });
    expect(finish.getNetArea()).toBeCloseTo(12 - 0.9 * 1.2, 9);
    // a window at sill 1.5 is entirely ABOVE the band — no subtraction
    session.dispatch('WINDOW.ADD', {
      wallId,
      t: 0.2,
      width: 1,
      sill: 1.5,
      height: 1,
    });
    expect(finish.getNetArea()).toBeCloseTo(12 - 0.9 * 1.2, 9);
  });

  test('count material yields tiles; erasing the wall cascades the finish', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const tile = tileMaterial(session);
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face-',
      materialId: tile,
    });
    const material = computeQuantities(session.doc).materials.find(
      (m) => m.name === 'Wall tile',
    )!;
    expect(material.unit).toBe('count');
    expect(material.quantity).toBeCloseTo(30 / 0.09, 6);

    session.dispatch('ENTITY.ERASE', { ids: [wallId] });
    expect(session.doc.has(id)).toBe(false); // cascaded with its host
  });

  test('FINISH.ADD validates the wall and material; finishes round-trip', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 6, 0);
    const tile = tileMaterial(session);
    expect(() =>
      session.dispatch('FINISH.ADD', {
        wallId,
        side: 'left',
        materialId: tile,
      }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.ADD', {
        wallId,
        side: 'face+',
        materialId: 'ghost',
      }),
    ).toThrow();
    session.dispatch('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tile,
      topHeight: 1.2,
    });
    session.open(session.save());
    const finishes = session.doc
      .all()
      .filter((e): e is FinishEntity => e instanceof FinishEntity);
    expect(finishes.length).toBe(1);
    expect(finishes[0].topHeight).toBe(1.2);
    expect(finishes[0].getNetArea()).toBeCloseTo(6 * 1.2, 9);
  });
});

describe('FINISH.UPDATE — edit the band in place', () => {
  test('every field updates; omitted fields keep their values; the id is stable', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const tile = tileMaterial(session);
    const paint = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Paint',
      unit: 'm2',
      costCode: 'paint',
    });
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tile,
    });
    const finish = session.doc.get(id) as FinishEntity;

    session.dispatch('FINISH.UPDATE', { id, topHeight: 1.2 });
    expect(finish.topHeight).toBe(1.2);
    // everything not passed is exactly as it was
    expect(finish.materialId).toBe(tile);
    expect(finish.sillHeight).toBe(0);
    expect(finish.t0).toBe(0);
    expect(finish.t1).toBe(1);
    expect(finish.thickness).toBe(0.01);
    expect(finish.phase).toBe('new');

    session.dispatch('FINISH.UPDATE', {
      id,
      materialId: paint,
      sillHeight: 0.1,
      topHeight: 2.4,
      t0: 0.25,
      t1: 0.75,
      thickness: 0.02,
    });
    expect(finish.materialId).toBe(paint);
    expect(finish.sillHeight).toBe(0.1);
    expect(finish.topHeight).toBe(2.4);
    expect(finish.t0).toBe(0.25);
    expect(finish.t1).toBe(0.75);
    expect(finish.thickness).toBe(0.02);
    // same entity throughout — no erase-and-re-add
    expect(session.doc.get(id)).toBe(finish);
  });

  test('fullHeight clears topHeight so the band follows the wall again', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tileMaterial(session),
      topHeight: 1.2,
    });
    const finish = session.doc.get(id) as FinishEntity;
    expect(finish.getNetArea()).toBeCloseTo(12, 9);

    session.dispatch('FINISH.UPDATE', { id, fullHeight: true });
    expect(finish.topHeight).toBeNull();
    expect(finish.getNetArea()).toBeCloseTo(30, 9); // 10 × 3
    // and it keeps following: raise the wall, the finish grows with it
    session.dispatch('WALL.SETPROPS', { ids: [wallId], height: 4 });
    expect(finish.getNetArea()).toBeCloseTo(40, 9);
  });

  test('narrowing the band to a dado re-measures around a window', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tileMaterial(session),
    });
    // window spans 0.9 → 2.1 vertically, 1 m wide
    session.dispatch('WINDOW.ADD', {
      wallId,
      t: 0.5,
      width: 1,
      sill: 0.9,
      height: 1.2,
    });
    const finish = session.doc.get(id) as FinishEntity;
    expect(finish.getNetArea()).toBeCloseTo(30 - 1 * 1.2, 9); // 28.8

    // tiling to a 1.2 m dado clips the window overlap to 0.9 → 1.2
    session.dispatch('FINISH.UPDATE', { id, topHeight: 1.2 });
    expect(finish.getNetArea()).toBeCloseTo(10 * 1.2 - 1 * 0.3, 9); // 11.7

    // half the wall's length, same band
    session.dispatch('FINISH.UPDATE', { id, t0: 0, t1: 0.5 });
    expect(finish.getNetArea()).toBeCloseTo(5 * 1.2 - 0.5 * 0.3, 9);
  });

  test('undo restores the previous band, material and thickness', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const tile = tileMaterial(session);
    const paint = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Paint',
      unit: 'm2',
      costCode: 'paint',
    });
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tile,
      sillHeight: 0.1,
      topHeight: 1.2,
      t0: 0.2,
      t1: 0.8,
      thickness: 0.015,
    });
    const finish = session.doc.get(id) as FinishEntity;
    const areaBefore = finish.getNetArea();

    session.dispatch('FINISH.UPDATE', {
      id,
      materialId: paint,
      sillHeight: 0,
      fullHeight: true,
      t0: 0,
      t1: 1,
      thickness: 0.03,
    });
    expect(finish.topHeight).toBeNull();
    expect(finish.getNetArea()).not.toBeCloseTo(areaBefore, 9);

    session.undo();
    const restored = session.doc.get(id) as FinishEntity;
    expect(restored.materialId).toBe(tile);
    expect(restored.sillHeight).toBe(0.1);
    expect(restored.topHeight).toBe(1.2);
    expect(restored.t0).toBe(0.2);
    expect(restored.t1).toBe(0.8);
    expect(restored.thickness).toBe(0.015);
    expect(restored.getNetArea()).toBeCloseTo(areaBefore, 9);

    session.redo();
    expect((session.doc.get(id) as FinishEntity).topHeight).toBeNull();
  });

  test('rejects a bad target, a bad material and an empty edit', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const tile = tileMaterial(session);
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tile,
    });
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id: 'ghost', topHeight: 1.2 }),
    ).toThrow();
    // a wall is not a finish
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id: wallId, topHeight: 1.2 }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, materialId: 'ghost' }),
    ).toThrow();
    expect(() => session.dispatch('FINISH.UPDATE', { id })).toThrow();
    // phase belongs to PHASE.SET — passing it here changes nothing
    session.dispatch('FINISH.UPDATE', {
      id,
      topHeight: 1.2,
      phase: 'demolish',
    });
    expect((session.doc.get(id) as FinishEntity).phase).toBe('new');
  });

  test('rejects an out-of-range or inverted band, against the merged values', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tileMaterial(session),
      sillHeight: 0.5,
      topHeight: 1.2,
      t0: 0.2,
      t1: 0.8,
    });
    const finish = session.doc.get(id) as FinishEntity;

    expect(() => session.dispatch('FINISH.UPDATE', { id, t0: -0.1 })).toThrow();
    expect(() => session.dispatch('FINISH.UPDATE', { id, t1: 1.4 })).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, t0: 0.9, t1: 0.4 }),
    ).toThrow();
    // t0 alone, checked against the t1 already on the entity (0.8)
    expect(() => session.dispatch('FINISH.UPDATE', { id, t0: 0.9 })).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, sillHeight: -0.2 }),
    ).toThrow();
    // sillHeight alone, checked against the topHeight already on the entity (1.2)
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, sillHeight: 2 }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, topHeight: 0.4 }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, thickness: 0 }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, thickness: -0.01 }),
    ).toThrow();
    // topHeight and fullHeight contradict each other
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, topHeight: 2, fullHeight: true }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, fullHeight: 'yes' }),
    ).toThrow();
    // fullHeight:false says nothing, so this is an empty edit
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, fullHeight: false }),
    ).toThrow();

    // every rejection left the finish untouched
    expect(finish.sillHeight).toBe(0.5);
    expect(finish.topHeight).toBe(1.2);
    expect(finish.t0).toBe(0.2);
    expect(finish.t1).toBe(0.8);
  });

  test('a slab-hosted finish takes material and thickness, refuses the band', () => {
    const session = new EditorSession();
    const slabId = session.dispatch<EntityId>('SLAB.ADD', {
      points: [point(0, 0), point(5, 0), point(5, 4), point(0, 4)],
    });
    const screed = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Screed',
      unit: 'm3',
      costCode: 'screed',
    });
    const vinyl = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Vinyl',
      unit: 'm2',
      costCode: 'vinyl',
    });
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', {
      slabId,
      materialId: screed,
    });
    const finish = session.doc.get(id) as FinishEntity;

    session.dispatch('FINISH.UPDATE', {
      id,
      materialId: vinyl,
      thickness: 0.05,
    });
    expect(finish.materialId).toBe(vinyl);
    expect(finish.thickness).toBe(0.05);
    expect(finish.getNetArea()).toBeCloseTo(20, 9); // still the whole footprint

    // band/extent describe a wall face and mean nothing on a footprint
    for (const band of [
      { sillHeight: 0.1 },
      { topHeight: 1.2 },
      { fullHeight: true },
      { t0: 0.2 },
      { t1: 0.8 },
    ]) {
      expect(() =>
        session.dispatch('FINISH.UPDATE', { id, ...band }),
      ).toThrow();
    }
    expect(finish.sillHeight).toBe(0);
    expect(finish.topHeight).toBeNull();
  });
});

describe('FinishEntity — floor/ceiling finish on a slab', () => {
  test('a floor finish covers the slab footprint; count material yields tiles', () => {
    const session = new EditorSession();
    const slabId = session.dispatch<EntityId>('SLAB.ADD', {
      points: [point(0, 0), point(5, 0), point(5, 4), point(0, 4)],
    });
    const tile = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Floor tile',
      unit: 'count',
      costCode: 'floor-tile',
      coverage: 0.09,
    });
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', {
      slabId,
      materialId: tile,
    });
    const finish = session.doc.get(id) as FinishEntity;
    expect(finish.getSide()).toBe('top');
    expect(finish.getNetArea()).toBeCloseTo(20, 9); // 5 × 4 footprint
    const material = computeQuantities(session.doc).materials.find(
      (m) => m.name === 'Floor tile',
    )!;
    expect(material.quantity).toBeCloseTo(20 / 0.09, 6);
  });

  test('ceiling variant + slab cascade; validates its target', () => {
    const session = new EditorSession();
    const slabId = session.dispatch<EntityId>('SLAB.ADD', {
      points: [point(0, 0), point(4, 0), point(4, 4), point(0, 4)],
    });
    const paint = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Ceiling paint',
      unit: 'm2',
      costCode: 'ceiling-paint',
    });
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', {
      slabId,
      materialId: paint,
      surface: 'bottom',
    });
    expect((session.doc.get(id) as FinishEntity).getSide()).toBe('bottom');
    // a wall is not a valid floor-finish target
    const wallId = addWall(session, 0, 0, 6, 0);
    expect(() =>
      session.dispatch('FLOORFINISH.ADD', {
        slabId: wallId,
        materialId: paint,
      }),
    ).toThrow();
    // erasing the slab cascades its finish
    session.dispatch('ENTITY.ERASE', { ids: [slabId] });
    expect(session.doc.has(id)).toBe(false);
  });
});

describe('FLOORFINISH.AUTO — floor every slab', () => {
  test('one finish per slab; regenerates independently of wall finishes', () => {
    const session = new EditorSession();
    drawRoom(session);
    addWall(session, 3, 0, 3, 4);
    session.dispatch('SLAB.AUTO', {}); // one slab per room → 2 slabs
    const floorTile = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Floor tile',
      unit: 'count',
      costCode: 'floor-tile',
      coverage: 0.09,
    });
    const wallTile = tileMaterial(session);
    session.dispatch('FINISH.AUTO', { materialId: wallTile, topHeight: 1.2 }); // 8 wall faces

    const floors = session.dispatch<{
      removed: number;
      created: number;
      totalArea: number;
    }>('FLOORFINISH.AUTO', { materialId: floorTile });
    expect(floors.created).toBe(2); // one per slab
    expect(floors.removed).toBe(0);
    expect(floors.totalArea).toBeGreaterThan(0);

    // re-running FLOORFINISH.AUTO replaces only floor finishes, not wall ones
    const wallFinishesBefore = session.doc
      .all()
      .filter(
        (e): e is FinishEntity =>
          e instanceof FinishEntity && e.getSide() === 'face+',
      ).length;
    const second = session.dispatch<{ removed: number; created: number }>(
      'FLOORFINISH.AUTO',
      {
        materialId: floorTile,
      },
    );
    expect(second.removed).toBe(2);
    const wallFinishesAfter = session.doc
      .all()
      .filter(
        (e): e is FinishEntity =>
          e instanceof FinishEntity && e.getSide() === 'face+',
      ).length;
    expect(wallFinishesAfter).toBe(wallFinishesBefore);
  });
});

describe('detectSpaces — room-facing boundary faces', () => {
  test('each boundary wall reports the side that looks into the room', () => {
    const session = new EditorSession();
    drawRoom(session);
    const [space] = detectSpaces(session.doc, null);
    expect(space.boundaryFaces.length).toBe(4);
    // verify each reported face actually points toward the room centroid
    for (const bf of space.boundaryFaces) {
      const wall = session.doc.get(bf.wallId)!;
      const anchor = (
        wall as unknown as {
          getAnchors(): { name?: string; geometry: { a: Point; b: Point } }[];
        }
      )
        .getAnchors()
        .find((a) => a.name === bf.side)!;
      const mid = {
        x: (anchor.geometry.a.x + anchor.geometry.b.x) / 2,
        y: (anchor.geometry.a.y + anchor.geometry.b.y) / 2,
      };
      // room centroid is (3, 2); the room-facing face sits inboard of the 3×2 box edge
      const towardCentre =
        Math.abs(mid.x - 3) <= 3 + 1e-6 && Math.abs(mid.y - 2) <= 2 + 1e-6;
      expect(towardCentre).toBe(true);
    }
  });
});

describe('FINISH.AUTO — tile every room', () => {
  test('one finish per room-facing wall; regenerates; shared walls get both sides', () => {
    const session = new EditorSession();
    drawRoom(session);
    const partitionId = addWall(session, 3, 0, 3, 4); // partition splits into two rooms
    const tile = tileMaterial(session);

    const first = session.dispatch<{
      removed: number;
      created: number;
      totalArea: number;
    }>('FINISH.AUTO', { materialId: tile, topHeight: 1.2 });
    expect(first.removed).toBe(0);
    // 2 rooms × 4 faces = 8 (the partition contributes a face to each room)
    expect(first.created).toBe(8);
    expect(first.totalArea).toBeGreaterThan(0);

    // the partition wall carries a finish on BOTH faces (one per room)
    const onPartition = session.doc
      .all()
      .filter((e): e is FinishEntity => e instanceof FinishEntity)
      .filter(
        (f) =>
          session.doc.relations.relationOfHosted(f.id)?.hostId === partitionId,
      );
    expect(onPartition.length).toBe(2);
    expect(new Set(onPartition.map((f) => f.getSide()))).toEqual(
      new Set(['face+', 'face-']),
    );

    // hand-placed finish survives regeneration
    const manual = session.dispatch<EntityId>('FINISH.ADD', {
      wallId: partitionId,
      side: 'face+',
      materialId: tile,
      topHeight: 2,
    });
    const second = session.dispatch<{ removed: number; created: number }>(
      'FINISH.AUTO',
      {
        materialId: tile,
      },
    );
    expect(second.removed).toBe(8);
    expect(session.doc.has(manual)).toBe(true);
  });
});

/**
 * Two conventions genuinely coexist in one estimate: the blockwork behind a
 * window may be measured solid while the paint over it is not. `solidWallRule`
 * offers that choice to a whole bill; `deductOpenings` brings it down to the
 * one layer it is actually an argument about.
 */
describe('FinishEntity — measured net or measured solid', () => {
  function paintedWallWithWindow(): {
    session: EditorSession;
    finish: FinishEntity;
  } {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const paint = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Paint',
      unit: 'm2',
      costCode: 'paint',
    });
    session.dispatch('WINDOW.ADD', { wallId, t: 0.5 });
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: paint,
    });
    return { session, finish: session.doc.get(id) as FinishEntity };
  }

  test('nets the openings out by default', () => {
    // the measured-net convention, and the one every drawing saved before this
    // field existed was priced under
    const { finish } = paintedWallWithWindow();
    expect(finish.deductOpenings).toBe(true);
    expect(finish.getNetArea()).toBeLessThan(10 * 3);
  });

  test('prices the full face when the openings do not deduct', () => {
    const { session, finish } = paintedWallWithWindow();
    const net = finish.getNetArea();
    session.dispatch('FINISH.UPDATE', {
      id: finish.id,
      deductOpenings: false,
    });
    expect(finish.getNetArea()).toBeCloseTo(10 * 3, 9);
    expect(finish.getNetArea()).toBeGreaterThan(net);
  });

  test('undo puts the convention back', () => {
    const { session, finish } = paintedWallWithWindow();
    const net = finish.getNetArea();
    session.dispatch('FINISH.UPDATE', {
      id: finish.id,
      deductOpenings: false,
    });
    session.undo();
    expect(finish.deductOpenings).toBe(true);
    expect(finish.getNetArea()).toBeCloseTo(net, 9);
  });

  test('survives a save and reopen', () => {
    // a flag that does not persist would re-price the job the next morning
    const { session, finish } = paintedWallWithWindow();
    session.dispatch('FINISH.UPDATE', {
      id: finish.id,
      deductOpenings: false,
    });
    const restored = new FinishEntity();
    restored.loadData(finish.saveData());
    expect(restored.deductOpenings).toBe(false);
  });

  test('an older drawing with no flag is still measured net', () => {
    // absent must not silently mean "solid" — that would re-price every job
    // ever saved before the field existed
    const finish = new FinishEntity();
    finish.loadData({
      id: finish.id,
      type: 'finish',
      layerId: finish.layerId,
      version: 1,
      props: {
        materialId: null,
        sillHeight: 0,
        topHeight: null,
        t0: 0,
        t1: 1,
        thickness: 0.01,
      },
    });
    expect(finish.deductOpenings).toBe(true);
  });

  test('a slab has no openings to argue about', () => {
    const session = new EditorSession();
    drawRoom(session);
    session.dispatch('SLAB.AUTO', {});
    const slabId = session.doc.all().find((e) => e.type === 'slab')?.id;
    const screed = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Screed',
      unit: 'm2',
      costCode: 'screed',
    });
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', {
      slabId,
      materialId: screed,
    });
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, deductOpenings: false }),
    ).toThrow();
  });
});

/**
 * A wall band is anchored to its wall and follows it. A slab footprint is an
 * arbitrary polygon with nothing to anchor against, so a partial floor is
 * stated the way an estimator measures one: a width and a height off the plan.
 */
describe('FinishEntity — a floor that is not the whole room', () => {
  function floored(): { session: EditorSession; finish: FinishEntity } {
    const session = new EditorSession();
    drawRoom(session);
    session.dispatch('SLAB.AUTO', {});
    const slabId = session.doc.all().find((e) => e.type === 'slab')?.id;
    const tile = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Floor tile',
      unit: 'm2',
      costCode: 'floor-tile',
    });
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', {
      slabId,
      materialId: tile,
    });
    return { session, finish: session.doc.get(id) as FinishEntity };
  }

  test('covers the whole footprint until told otherwise', () => {
    const { finish } = floored();
    expect(finish.coverWidth).toBeNull();
    expect(finish.getNetArea()).toBeGreaterThan(0);
  });

  test('covers the rectangle it is given', () => {
    const { session, finish } = floored();
    const whole = finish.getNetArea();
    session.dispatch('FINISH.UPDATE', {
      id: finish.id,
      coverWidth: 3,
      coverHeight: 4,
    });
    expect(finish.getNetArea()).toBeCloseTo(12, 9);
    expect(finish.getNetArea()).toBeLessThan(whole);
    // and the run around what is covered, for an edge trim
    expect(finish.getCoveredLength()).toBeCloseTo(14, 9);
  });

  test('goes back to the whole footprint', () => {
    const { session, finish } = floored();
    const whole = finish.getNetArea();
    session.dispatch('FINISH.UPDATE', {
      id: finish.id,
      coverWidth: 3,
      coverHeight: 4,
    });
    session.dispatch('FINISH.UPDATE', { id: finish.id, wholeSlab: true });
    expect(finish.coverWidth).toBeNull();
    expect(finish.getNetArea()).toBeCloseTo(whole, 9);
  });

  test('refuses half a rectangle', () => {
    // one dimension alone cannot say what area is covered, and defaulting the
    // other would invent a measurement the user never took
    const { session, finish } = floored();
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id: finish.id, coverWidth: 3 }),
    ).toThrow();
  });

  test('refuses a covered rectangle on a wall face', () => {
    // a wall band is already a width and a height, and an anchored one; two
    // ways to state one extent leaves nothing to say which the area came from
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const id = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: tileMaterial(session),
    });
    expect(() =>
      session.dispatch('FINISH.UPDATE', { id, coverWidth: 3, coverHeight: 4 }),
    ).toThrow();
  });

  test('persists, and undoes', () => {
    const { session, finish } = floored();
    const whole = finish.getNetArea();
    session.dispatch('FINISH.UPDATE', {
      id: finish.id,
      coverWidth: 2,
      coverHeight: 2,
    });
    const restored = new FinishEntity();
    restored.loadData(finish.saveData());
    expect(restored.coverWidth).toBe(2);
    expect(restored.coverHeight).toBe(2);
    session.undo();
    expect(finish.getNetArea()).toBeCloseTo(whole, 9);
  });
});
