import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  ValidationError,
  WallEntity,
  computeQuantities,
  point,
} from '../src/index.js';
import type { EntityId, MaterialId, TypeId } from '../src/index.js';

function addWall(session: EditorSession, extra: Record<string, unknown> = {}) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(10, 0),
    thickness: 0.3,
    height: 3,
    ...extra,
  });
}

describe('quantity takeoff', () => {
  test('net face area and volume deduct openings', () => {
    const session = new EditorSession();
    const wallId = addWall(session);
    session.dispatch('WINDOW.ADD', { wallId, t: 0.5, width: 2, sill: 0.9, height: 1.2 });

    const report = computeQuantities(session.doc);
    expect(report.walls).toHaveLength(1);
    // face: 10×3 − 2×1.2 = 27.6
    expect(report.walls[0].netFaceArea).toBeCloseTo(27.6);
    // volume: 10×0.3×3 − 2×0.3×1.2 = 8.28
    expect(report.walls[0].netVolume).toBeCloseTo(8.28);
    expect(report.walls[0].openings).toBe(1);
    expect(report.totals.windowCount).toBe(1);
    expect(report.totals.doorCount).toBe(0);
  });

  test('assembly layers split the net volume per material', () => {
    const session = new EditorSession();
    const block = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Block', unit: 'm3' });
    const plaster = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Plaster', unit: 'm3' });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'wall',
      name: 'Block 300',
      layers: [
        { materialId: block, thickness: 0.2 },
        { materialId: plaster, thickness: 0.1 },
      ],
    });
    const wallId = addWall(session, { typeId });

    // thickness comes from the catalog: 0.2 + 0.1 = 0.3
    expect((session.doc.get(wallId) as WallEntity).getThickness()).toBeCloseTo(0.3);

    const report = computeQuantities(session.doc);
    const netVolume = report.walls[0].netVolume; // 10×0.3×3 = 9
    expect(netVolume).toBeCloseTo(9);
    const blockQ = report.materials.find((m) => m.name === 'Block');
    const plasterQ = report.materials.find((m) => m.name === 'Plaster');
    expect(blockQ?.quantity).toBeCloseTo(6); // 2/3 of 9
    expect(plasterQ?.quantity).toBeCloseTo(3); // 1/3 of 9
  });

  test('quantities update live as the model changes', () => {
    const session = new EditorSession();
    const wallId = addWall(session);
    expect(computeQuantities(session.doc).totals.wallNetVolume).toBeCloseTo(9);

    session.dispatch('DOOR.ADD', { wallId, t: 0.3, width: 1, height: 2.1 });
    expect(computeQuantities(session.doc).totals.wallNetVolume).toBeCloseTo(9 - 1 * 0.3 * 2.1);
    expect(computeQuantities(session.doc).totals.doorCount).toBe(1);

    session.undo();
    expect(computeQuantities(session.doc).totals.wallNetVolume).toBeCloseTo(9);
  });

  test('TYPE.ADD validates material references; MATERIAL.ADD is undoable', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('TYPE.ADD', {
        targetType: 'wall',
        name: 'Bad',
        layers: [{ materialId: 'missing', thickness: 0.1 }],
      }),
    ).toThrow(ValidationError);
    expect(session.doc.types.list()).toHaveLength(0);

    const materialId = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Brick' });
    expect(session.doc.materials.get(materialId)?.name).toBe('Brick');
    session.undo();
    expect(session.doc.materials.get(materialId)).toBeNull();
  });

  test('WALL.ADD rejects a missing typeId', () => {
    const session = new EditorSession();
    expect(() => addWall(session, { typeId: 'missing' })).toThrow(ValidationError);
    expect(session.doc.count).toBe(0);
  });
});
