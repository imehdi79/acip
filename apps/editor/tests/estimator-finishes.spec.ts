import { describe, expect, it } from 'vitest';
import { EditorSession, point } from '@acip/editor-core';
import type { EntityId, MaterialId } from '@acip/editor-core';
import { assembleBoq } from '@acip/estimator';
import { STARTER_MATERIALS, seedMaterials } from '@/data/materials';
import {
  anchorForSide,
  finishTargetFor,
  finishesOnFace,
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

  it('says why a room cannot take one yet', () => {
    // core hosts a floor finish on the SLAB under the room, and making one is
    // a change to the drawing nobody asked for by opening a sheet
    const { session } = plan();
    const room = estimatorSteps(session.doc, null).find(
      (s) => s.kind === 'room',
    );
    if (!room) throw new Error('the four walls enclosed no room');
    const target = finishTargetFor(session.doc, room);
    expect(target.kind).toBe('none');
    expect(target.kind === 'none' && target.reason).toMatch(/slab/i);
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
