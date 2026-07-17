import { describe, expect, test } from 'bun:test';
import { EditorSession, FinishEntity, computeQuantities, detectSpaces, point } from '../src/index.js';
import type { EntityId, MaterialId, Point } from '../src/index.js';

function addWall(session: EditorSession, ax: number, ay: number, bx: number, by: number): EntityId {
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
    session.dispatch('WINDOW.ADD', { wallId, t: 0.2, width: 1, sill: 1.5, height: 1 });
    expect(finish.getNetArea()).toBeCloseTo(12 - 0.9 * 1.2, 9);
  });

  test('count material yields tiles; erasing the wall cascades the finish', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const tile = tileMaterial(session);
    const id = session.dispatch<EntityId>('FINISH.ADD', { wallId, side: 'face-', materialId: tile });
    const material = computeQuantities(session.doc).materials.find((m) => m.name === 'Wall tile')!;
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
      session.dispatch('FINISH.ADD', { wallId, side: 'left', materialId: tile }),
    ).toThrow();
    expect(() =>
      session.dispatch('FINISH.ADD', { wallId, side: 'face+', materialId: 'ghost' }),
    ).toThrow();
    session.dispatch('FINISH.ADD', { wallId, side: 'face+', materialId: tile, topHeight: 1.2 });
    session.open(session.save());
    const finishes = session.doc.all().filter((e): e is FinishEntity => e instanceof FinishEntity);
    expect(finishes.length).toBe(1);
    expect(finishes[0].topHeight).toBe(1.2);
    expect(finishes[0].getNetArea()).toBeCloseTo(6 * 1.2, 9);
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
    const id = session.dispatch<EntityId>('FLOORFINISH.ADD', { slabId, materialId: tile });
    const finish = session.doc.get(id) as FinishEntity;
    expect(finish.getSide()).toBe('top');
    expect(finish.getNetArea()).toBeCloseTo(20, 9); // 5 × 4 footprint
    const material = computeQuantities(session.doc).materials.find((m) => m.name === 'Floor tile')!;
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
      session.dispatch('FLOORFINISH.ADD', { slabId: wallId, materialId: paint }),
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

    const floors = session.dispatch<{ removed: number; created: number; totalArea: number }>(
      'FLOORFINISH.AUTO',
      { materialId: floorTile },
    );
    expect(floors.created).toBe(2); // one per slab
    expect(floors.removed).toBe(0);
    expect(floors.totalArea).toBeGreaterThan(0);

    // re-running FLOORFINISH.AUTO replaces only floor finishes, not wall ones
    const wallFinishesBefore = session.doc
      .all()
      .filter((e): e is FinishEntity => e instanceof FinishEntity && e.getSide() === 'face+').length;
    const second = session.dispatch<{ removed: number; created: number }>('FLOORFINISH.AUTO', {
      materialId: floorTile,
    });
    expect(second.removed).toBe(2);
    const wallFinishesAfter = session.doc
      .all()
      .filter((e): e is FinishEntity => e instanceof FinishEntity && e.getSide() === 'face+').length;
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
      const anchor = (wall as unknown as { getAnchors(): { name?: string; geometry: { a: Point; b: Point } }[] })
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

    const first = session.dispatch<{ removed: number; created: number; totalArea: number }>(
      'FINISH.AUTO',
      { materialId: tile, topHeight: 1.2 },
    );
    expect(first.removed).toBe(0);
    // 2 rooms × 4 faces = 8 (the partition contributes a face to each room)
    expect(first.created).toBe(8);
    expect(first.totalArea).toBeGreaterThan(0);

    // the partition wall carries a finish on BOTH faces (one per room)
    const onPartition = session.doc
      .all()
      .filter((e): e is FinishEntity => e instanceof FinishEntity)
      .filter((f) => session.doc.relations.relationOfHosted(f.id)?.hostId === partitionId);
    expect(onPartition.length).toBe(2);
    expect(new Set(onPartition.map((f) => f.getSide()))).toEqual(new Set(['face+', 'face-']));

    // hand-placed finish survives regeneration
    const manual = session.dispatch<EntityId>('FINISH.ADD', {
      wallId: partitionId,
      side: 'face+',
      materialId: tile,
      topHeight: 2,
    });
    const second = session.dispatch<{ removed: number; created: number }>('FINISH.AUTO', {
      materialId: tile,
    });
    expect(second.removed).toBe(8);
    expect(session.doc.has(manual)).toBe(true);
  });
});
