import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  point,
  wallAssemblyStrips,
} from '../src/index.js';
import type { EntityId, MaterialId, TypeId } from '../src/index.js';

function seedAssembly(session: EditorSession): {
  block: MaterialId;
  insulation: MaterialId;
  plaster: MaterialId;
  typeId: TypeId;
} {
  const block = session.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Block' });
  const insulation = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Insulation',
    hatch: 'cross',
  });
  const plaster = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Plaster',
  });
  const typeId = session.dispatch<TypeId>('TYPE.ADD', {
    targetType: 'wall',
    name: 'Ext 27',
    layers: [
      { materialId: block, thickness: 0.2 },
      { materialId: insulation, thickness: 0.05 },
      { materialId: plaster, thickness: 0.02 },
    ],
  });
  return { block, insulation, plaster, typeId };
}

describe('wallAssemblyStrips — per-layer plan strips from the type catalog', () => {
  test('partitions the thickness outermost-first on the face+ side', () => {
    const session = new EditorSession();
    const { block, plaster, typeId } = seedAssembly(session);
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(10, 0),
      typeId,
    });
    const wall = session.doc.get(wallId) as WallEntity;

    const display = wallAssemblyStrips(session.doc, wall);
    expect(display).not.toBeNull();
    const { strips, separators } = display!;

    // a→b along +x means +normal (face+) is +y; total 0.27 centered on y=0
    expect(strips.length).toBe(3);
    expect(strips[0].materialId).toBe(block);
    expect(strips[0].regions[0].boundary[0].y).toBeCloseTo(0.135, 9);
    expect(strips[0].regions[0].boundary[2].y).toBeCloseTo(-0.065, 9);
    expect(strips[2].materialId).toBe(plaster);
    expect(strips[2].regions[0].boundary[2].y).toBeCloseTo(-0.135, 9);

    // one separation line per interior boundary, full span length
    expect(separators.length).toBe(2);
    expect(separators[0].a.y).toBeCloseTo(-0.065, 9);
    expect(separators[1].a.y).toBeCloseTo(-0.115, 9);
    expect(separators[0].b.x - separators[0].a.x).toBeCloseTo(10, 9);
  });

  test('openings split every strip and separator with the solid spans', () => {
    const session = new EditorSession();
    const { typeId } = seedAssembly(session);
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(10, 0),
      typeId,
    });
    session.dispatch('WINDOW.ADD', { wallId, t: 0.5, width: 1 });
    const wall = session.doc.get(wallId) as WallEntity;

    const display = wallAssemblyStrips(session.doc, wall)!;
    for (const strip of display.strips) {
      expect(strip.regions.length).toBe(2);
      expect(strip.regions[0].boundary[1].x).toBeCloseTo(4.5, 9);
      expect(strip.regions[1].boundary[0].x).toBeCloseTo(5.5, 9);
    }
    expect(display.separators.length).toBe(4); // 2 interior offsets × 2 spans
  });

  test('single-layer assemblies yield one strip and no separators', () => {
    const session = new EditorSession();
    const mat = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Concrete',
    });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'wall',
      name: 'RC 200',
      layers: [{ materialId: mat, thickness: 0.2 }],
    });
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(5, 0),
      typeId,
    });
    const display = wallAssemblyStrips(
      session.doc,
      session.doc.get(wallId) as WallEntity,
    )!;
    expect(display.strips.length).toBe(1);
    expect(display.separators.length).toBe(0);
  });

  test('walls without a typed assembly return null', () => {
    const session = new EditorSession();
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(5, 0),
    });
    expect(
      wallAssemblyStrips(session.doc, session.doc.get(wallId) as WallEntity),
    ).toBeNull();
  });
});

describe('MATERIAL color — appearance.color via commands', () => {
  test('ADD stores it, UPDATE merges it, undo restores it', () => {
    const session = new EditorSession();
    const id = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Brick',
      color: '#b06a4a',
    });
    expect(session.doc.materials.get(id)?.appearance?.['color']).toBe(
      '#b06a4a',
    );

    session.dispatch('MATERIAL.UPDATE', { id, color: '#aabbcc' });
    expect(session.doc.materials.get(id)?.appearance?.['color']).toBe(
      '#aabbcc',
    );

    session.undo();
    expect(session.doc.materials.get(id)?.appearance?.['color']).toBe(
      '#b06a4a',
    );
  });
});
