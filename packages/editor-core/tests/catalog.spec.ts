import { describe, expect, test } from 'bun:test';
import { EditorSession, WallEntity, computeQuantities, point } from '../src/index.js';
import type { EntityId, MaterialId, TypeId } from '../src/index.js';

function seedWallCatalog(session: EditorSession): { block: MaterialId; typeId: TypeId } {
  const block = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Block',
    costCode: 'block',
  });
  const typeId = session.dispatch<TypeId>('TYPE.ADD', {
    targetType: 'wall',
    name: 'B300',
    layers: [{ materialId: block, thickness: 0.3 }],
  });
  return { block, typeId };
}

describe('TYPE.UPDATE — change the type, every instance re-derives', () => {
  test('replacing layers re-thickens walls live; one undo restores', () => {
    const session = new EditorSession();
    const { block, typeId } = seedWallCatalog(session);
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(10, 0),
      typeId,
    });
    const wall = session.doc.get(wallId) as WallEntity;
    expect(wall.getThickness()).toBeCloseTo(0.3, 9);

    session.dispatch('TYPE.UPDATE', {
      id: typeId,
      layers: [{ materialId: block, thickness: 0.5 }],
    });
    expect(wall.getThickness()).toBeCloseTo(0.5, 9);
    expect(computeQuantities(session.doc).totals.wallNetVolume).toBeCloseTo(10 * 3 * 0.5, 9);

    session.undo();
    expect(wall.getThickness()).toBeCloseTo(0.3, 9);
  });

  test('a type change refreshes the spatial bounds of its instances', () => {
    const session = new EditorSession();
    const { block, typeId } = seedWallCatalog(session);
    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(10, 0), typeId });
    // a point 0.4 m off the baseline is outside a 0.3 wall's bounds…
    const probe = { minX: 4, minY: 0.4, maxX: 5, maxY: 0.5 };
    expect(session.doc.queryBBox(probe).length).toBe(0);
    // …and inside after the assembly grows to 1.0 — without touching the wall
    session.dispatch('TYPE.UPDATE', {
      id: typeId,
      layers: [{ materialId: block, thickness: 1.0 }],
    });
    expect(session.doc.queryBBox(probe).length).toBe(1);
  });

  test('validates material references and requires a change', () => {
    const session = new EditorSession();
    const { typeId } = seedWallCatalog(session);
    expect(() =>
      session.dispatch('TYPE.UPDATE', {
        id: typeId,
        layers: [{ materialId: 'ghost', thickness: 0.1 }],
      }),
    ).toThrow();
    expect(() => session.dispatch('TYPE.UPDATE', { id: typeId })).toThrow();
  });
});

describe('ENTITY.SETTYPE — the value-engineering primitive', () => {
  test('retypes entities, validates targetType, clears back to local props', () => {
    const session = new EditorSession();
    const { typeId } = seedWallCatalog(session);
    const lighter = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Stud',
      costCode: 'stud',
    });
    const studType = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'wall',
      name: 'Stud 100',
      layers: [{ materialId: lighter, thickness: 0.1 }],
    });
    const slabType = session.dispatch<TypeId>('TYPE.ADD', { targetType: 'slab', name: 'S200' });

    const a = session.dispatch<EntityId>('WALL.ADD', { a: point(0, 0), b: point(6, 0), typeId });
    const b = session.dispatch<EntityId>('WALL.ADD', { a: point(0, 2), b: point(6, 2), typeId });
    const wallA = session.doc.get(a) as WallEntity;

    const count = session.dispatch<number>('ENTITY.SETTYPE', { ids: [a, b], typeId: studType });
    expect(count).toBe(2);
    expect(wallA.getThickness()).toBeCloseTo(0.1, 9);

    // one undo restores both previous type refs
    session.undo();
    expect(wallA.getThickness()).toBeCloseTo(0.3, 9);

    // a wall cannot take a slab type
    expect(() => session.dispatch('ENTITY.SETTYPE', { ids: [a], typeId: slabType })).toThrow();

    // clearing falls back to the local thickness prop
    session.dispatch('ENTITY.SETTYPE', { ids: [a] });
    expect(wallA.typeRef).toBeUndefined();
    expect(wallA.getThickness()).toBeCloseTo(0.3, 9); // local default
  });
});

describe('catalog removal guards', () => {
  test('TYPE.REMOVE is blocked while referenced and allowed after clearing', () => {
    const session = new EditorSession();
    const { typeId } = seedWallCatalog(session);
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(6, 0),
      typeId,
    });
    expect(() => session.dispatch('TYPE.REMOVE', { id: typeId })).toThrow();
    session.dispatch('ENTITY.SETTYPE', { ids: [wallId] });
    session.dispatch('TYPE.REMOVE', { id: typeId });
    expect(session.doc.types.has(typeId)).toBe(false);
  });

  test('MATERIAL.REMOVE is blocked while a type layer references it', () => {
    const session = new EditorSession();
    const { block, typeId } = seedWallCatalog(session);
    expect(() => session.dispatch('MATERIAL.REMOVE', { id: block })).toThrow();
    session.dispatch('TYPE.UPDATE', { id: typeId, name: 'B300 (no layers…)' });
    // still referenced — renaming did not drop the layer
    expect(() => session.dispatch('MATERIAL.REMOVE', { id: block })).toThrow();
    session.dispatch('TYPE.REMOVE', { id: typeId });
    session.dispatch('MATERIAL.REMOVE', { id: block });
    expect(session.doc.materials.has(block)).toBe(false);
  });

  test('MATERIAL.UPDATE renames and re-codes; quantities follow', () => {
    const session = new EditorSession();
    const { block, typeId } = seedWallCatalog(session);
    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(10, 0), typeId });
    session.dispatch('MATERIAL.UPDATE', { id: block, name: 'AAC block', costCode: 'aac' });
    const report = computeQuantities(session.doc);
    expect(report.materials[0].name).toBe('AAC block');
    expect(session.doc.materials.get(block)?.costCode).toBe('aac');
  });
});
