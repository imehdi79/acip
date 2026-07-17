import { describe, expect, test } from 'bun:test';
import { EditorSession, computeQuantities, layerQuantity, point } from '../src/index.js';
import type { EntityId, MaterialId, TypeId } from '../src/index.js';

describe('layerQuantity — pure unit mapping', () => {
  const refs = { volume: 3, area: 30, length: 10 };
  test('m3 takes a thickness-proportional volume share', () => {
    expect(layerQuantity('m3', 0.2, 0.5, refs)).toBeCloseTo(3 * (0.2 / 0.5), 9);
  });
  test('m2 takes the full reference area, thickness-independent', () => {
    expect(layerQuantity('m2', 0.002, 0.5, refs)).toBeCloseTo(30, 9);
  });
  test('m takes the reference length', () => {
    expect(layerQuantity('m', 0.05, 0.5, refs)).toBeCloseTo(10, 9);
  });
  test('count is area ÷ coverage; missing coverage falls back to 1/m²', () => {
    expect(layerQuantity('count', 0, 0.5, refs, 0.09)).toBeCloseTo(30 / 0.09, 9);
    expect(layerQuantity('count', 0, 0.5, refs)).toBeCloseTo(30, 9);
  });
});

/** a wall type: 0.2 block (m³) + 2 mm membrane (m²) + tiles (count, 0.09 m²) */
function buildMixedWall(session: EditorSession): { wallId: EntityId } {
  const block = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Block',
    unit: 'm3',
    costCode: 'block',
  });
  const membrane = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Membrane',
    unit: 'm2',
    costCode: 'membrane',
  });
  const tile = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Tile',
    unit: 'count',
    costCode: 'tile',
    coverage: 0.09,
  });
  const typeId = session.dispatch<TypeId>('TYPE.ADD', {
    targetType: 'wall',
    name: 'Tiled wall',
    layers: [
      { materialId: block, thickness: 0.2 },
      { materialId: membrane, thickness: 0.002 },
      { materialId: tile, thickness: 0.01 },
    ],
  });
  const wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(10, 0),
    height: 3,
    typeId,
  });
  return { wallId };
}

describe('computeQuantities — each layer in its own unit', () => {
  test('a 10×3 wall: block by volume, membrane by area, tiles by count', () => {
    const session = new EditorSession();
    buildMixedWall(session);
    const materials = computeQuantities(session.doc).materials;
    const byName = new Map(materials.map((m) => [m.name, m]));

    const block = byName.get('Block')!;
    expect(block.unit).toBe('m3');
    // net volume 10×3×0.212, block share = ×(0.2/0.212)
    expect(block.quantity).toBeCloseTo(10 * 3 * 0.2, 6);

    const membrane = byName.get('Membrane')!;
    expect(membrane.unit).toBe('m2');
    expect(membrane.quantity).toBeCloseTo(30, 6); // face area, not a volume sliver

    const tile = byName.get('Tile')!;
    expect(tile.unit).toBe('count');
    expect(tile.quantity).toBeCloseTo(30 / 0.09, 6); // area ÷ tile size
  });

  test('openings deduct from face area for m² and count layers alike', () => {
    const session = new EditorSession();
    const { wallId } = buildMixedWall(session);
    session.dispatch('DOOR.ADD', { wallId, t: 0.5, width: 1, height: 2 });
    const byName = new Map(
      computeQuantities(session.doc).materials.map((m) => [m.name, m]),
    );
    // face area 30 − door 1×2 = 28
    expect(byName.get('Membrane')!.quantity).toBeCloseTo(28, 6);
    expect(byName.get('Tile')!.quantity).toBeCloseTo(28 / 0.09, 6);
  });
});
