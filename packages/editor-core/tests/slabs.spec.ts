import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  SlabEntity,
  computeQuantities,
  extrudePolygon,
  point,
  triangulateLoop,
} from '../src/index.js';
import type { EntityId, LevelId, MaterialId, Point, TypeId } from '../src/index.js';

function triangleArea(a: Point, b: Point, c: Point): number {
  return Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
}

const L_SHAPE: Point[] = [
  point(0, 0),
  point(6, 0),
  point(6, 2),
  point(3, 2),
  point(3, 4),
  point(0, 4),
];

describe('polygon triangulation and extrusion', () => {
  test('convex quad clips into two triangles covering its area', () => {
    const square = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    const tris = triangulateLoop(square);
    expect(tris.length).toBe(6);
    let area = 0;
    for (let i = 0; i < tris.length; i += 3) {
      area += triangleArea(square[tris[i]], square[tris[i + 1]], square[tris[i + 2]]);
    }
    expect(area).toBeCloseTo(16, 9);
  });

  test('concave L-shape triangulates to the exact polygon area, either winding', () => {
    for (const loop of [L_SHAPE, [...L_SHAPE].reverse()]) {
      const tris = triangulateLoop(loop);
      expect(tris.length).toBe((loop.length - 2) * 3);
      let area = 0;
      for (let i = 0; i < tris.length; i += 3) {
        area += triangleArea(loop[tris[i]], loop[tris[i + 1]], loop[tris[i + 2]]);
      }
      expect(area).toBeCloseTo(18, 9); // 6×4 minus the 3×2 notch
    }
  });

  test('extrudePolygon builds a closed body between z0 and z1', () => {
    const mesh = extrudePolygon(L_SHAPE, -0.2, 0);
    expect(mesh.positions.length).toBe(L_SHAPE.length * 2 * 3);
    expect(mesh.indices.length % 3).toBe(0);
    for (let i = 2; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(-0.2);
      expect(mesh.positions[i]).toBeLessThanOrEqual(0);
    }
  });
});

function addWall(session: EditorSession, ax: number, ay: number, bx: number, by: number) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });
}

function seedSlabType(session: EditorSession): TypeId {
  const concrete = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Concrete slab',
    costCode: 'concrete-slab',
  });
  const screed = session.dispatch<MaterialId>('MATERIAL.ADD', {
    name: 'Screed',
    costCode: 'screed',
  });
  return session.dispatch<TypeId>('TYPE.ADD', {
    targetType: 'slab',
    name: 'Slab 200 (15+5)',
    layers: [
      { materialId: concrete, thickness: 0.15 },
      { materialId: screed, thickness: 0.05 },
    ],
  });
}

describe('SlabEntity — footprint + level + assembly', () => {
  test('SLAB.ADD creates a region entity; type assembly wins over local thickness', () => {
    const session = new EditorSession();
    const typeId = seedSlabType(session);
    const id = session.dispatch<EntityId>('SLAB.ADD', {
      points: L_SHAPE,
      thickness: 0.5,
      typeId,
    });
    const slab = session.doc.get(id) as SlabEntity;
    expect(slab).toBeInstanceOf(SlabEntity);
    expect(slab.getArea()).toBeCloseTo(18, 9);
    expect(slab.getThickness()).toBeCloseTo(0.2, 9); // 0.15 + 0.05 from the type
    expect(session.measure.areaOf(id)).toBeCloseTo(18, 9);
    expect(slab.hitTest(point(1, 1), 0.1)).toBe(true); // interior
    expect(slab.hitTest(point(5, 3.5), 0.1)).toBe(false); // inside the notch
  });

  test('degenerate footprints are rejected', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('SLAB.ADD', { points: [point(0, 0), point(1, 0), point(2, 0)] }),
    ).toThrow();
  });

  test('the top face sits at the level elevation and extrudes down', () => {
    const session = new EditorSession();
    const level = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    const id = session.dispatch<EntityId>('SLAB.ADD', {
      points: [point(0, 0), point(4, 0), point(4, 4), point(0, 4)],
      levelId: level,
    });
    const slab = session.doc.get(id) as SlabEntity;
    const zs: number[] = [];
    const mesh = slab.toMesh('medium');
    for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]);
    expect(Math.max(...zs)).toBeCloseTo(3, 9);
    expect(Math.min(...zs)).toBeCloseTo(2.8, 9); // 0.2 default thickness below
  });

  test('slabs round-trip through save/open', () => {
    const session = new EditorSession();
    session.dispatch('SLAB.ADD', { points: L_SHAPE, thickness: 0.25 });
    session.open(session.save());
    const slabs = session.doc.all().filter((e): e is SlabEntity => e instanceof SlabEntity);
    expect(slabs.length).toBe(1);
    expect(slabs[0].getArea()).toBeCloseTo(18, 9);
    expect(slabs[0].getThickness()).toBeCloseTo(0.25, 9);
  });
});

describe('SLAB.AUTO — floor every detected room', () => {
  test('room + partition: one slab per room from net boundaries, regenerated on re-run', () => {
    const session = new EditorSession();
    const typeId = seedSlabType(session);
    addWall(session, 0, 0, 6, 0);
    addWall(session, 6, 0, 6, 4);
    addWall(session, 6, 4, 0, 4);
    addWall(session, 0, 4, 0, 0);
    addWall(session, 2, 0, 2, 4);

    const first = session.dispatch<{ removed: number; created: number; totalArea: number }>(
      'SLAB.AUTO',
      { typeId },
    );
    expect(first.removed).toBe(0);
    expect(first.created).toBe(2);
    expect(first.totalArea).toBeCloseTo(1.7 * 3.7 + 3.7 * 3.7, 6); // net room areas

    // hand-placed slabs survive regeneration; auto slabs are replaced
    const manual = session.dispatch<EntityId>('SLAB.ADD', {
      points: [point(10, 0), point(12, 0), point(12, 2), point(10, 2)],
    });
    const second = session.dispatch<{ removed: number; created: number }>('SLAB.AUTO', {
      typeId,
    });
    expect(second.removed).toBe(2);
    expect(second.created).toBe(2);
    expect(session.doc.has(manual)).toBe(true);

    // quantities feed the estimator: area, volume, and per-material split
    const report = computeQuantities(session.doc);
    expect(report.totals.slabArea).toBeCloseTo(first.totalArea + 4, 6);
    expect(report.totals.slabVolume).toBeCloseTo(first.totalArea * 0.2 + 4 * 0.2, 6);
    const concrete = report.materials.find((m) => m.name === 'Concrete slab')!;
    expect(concrete.volume).toBeCloseTo(first.totalArea * 0.2 * (0.15 / 0.2), 6);
  });
});
