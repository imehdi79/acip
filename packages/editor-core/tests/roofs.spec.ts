import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  RoofEntity,
  computeQuantities,
  detectOutlines,
  loftPolygon,
  loopSignedArea,
  point,
} from '../src/index.js';
import type { EntityId, LevelId, MaterialId, TypeId } from '../src/index.js';

function addWall(session: EditorSession, ax: number, ay: number, bx: number, by: number) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });
}

/** 6×4 room of 0.3 m walls drawn to centerlines, counter-clockwise */
function drawRoom(session: EditorSession, dx = 0): void {
  addWall(session, dx, 0, dx + 6, 0);
  addWall(session, dx + 6, 0, dx + 6, 4);
  addWall(session, dx + 6, 4, dx, 4);
  addWall(session, dx, 4, dx, 0);
}

function zRange(mesh: { positions: readonly number[] }): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (let i = 2; i < mesh.positions.length; i += 3) {
    min = Math.min(min, mesh.positions[i]);
    max = Math.max(max, mesh.positions[i]);
  }
  return { min, max };
}

describe('loftPolygon — per-vertex heights', () => {
  test('lofts a sloped body between two rings', () => {
    const points = [point(0, 0), point(4, 0), point(4, 2), point(0, 2)];
    const mesh = loftPolygon(points, [0, 0, 0.5, 0.5], [1, 1, 1.5, 1.5]);
    expect(mesh.positions.length).toBe(points.length * 2 * 3);
    expect(mesh.indices.length % 3).toBe(0);
    const { min, max } = zRange(mesh);
    expect(min).toBeCloseTo(0, 9);
    expect(max).toBeCloseTo(1.5, 9);
  });

  test('mismatched ring lengths return the empty mesh', () => {
    const points = [point(0, 0), point(1, 0), point(1, 1)];
    expect(loftPolygon(points, [0, 0], [1, 1, 1]).positions.length).toBe(0);
  });
});

describe('RoofEntity — mono-pitch plane', () => {
  test('ROOF.ADD: plan and slope areas, eaves at the downhill edge', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('ROOF.ADD', {
      points: [point(0, 0), point(6, 0), point(6, 4), point(0, 4)],
      slope: 30,
      direction: point(0, -1),
      eavesHeight: 3,
    });
    const roof = session.doc.get(id) as RoofEntity;
    expect(roof).toBeInstanceOf(RoofEntity);
    expect(roof.getPlanArea()).toBeCloseTo(24, 9);
    expect(roof.getSlopeArea()).toBeCloseTo(24 / Math.cos(Math.PI / 6), 9);
    const { min, max } = zRange(roof.toMesh('medium'));
    // downhill is −y: eaves at y=0, ridge side at y=4 → 3 + tan30°·4
    expect(max).toBeCloseTo(3 + Math.tan(Math.PI / 6) * 4, 9);
    expect(min).toBeCloseTo(3 - 0.25, 9); // default thickness below the eaves
  });

  test('roof type assembly wins over local thickness; round-trips', () => {
    const session = new EditorSession();
    const structure = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Roof structure',
      costCode: 'roof-structure',
    });
    const typeId = session.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'roof',
      name: 'R300',
      layers: [{ materialId: structure, thickness: 0.3 }],
    });
    session.dispatch('ROOF.ADD', {
      points: [point(0, 0), point(4, 0), point(4, 4), point(0, 4)],
      thickness: 0.1,
      typeId,
    });
    session.open(session.save());
    const roof = session.doc.all().find((e): e is RoofEntity => e instanceof RoofEntity)!;
    expect(roof.getThickness()).toBeCloseTo(0.3, 9);
    expect(roof.slope).toBeCloseTo(15, 9);
  });
});

describe('detectOutlines — the building contour', () => {
  test('outer contour at centerlines and outer faces', () => {
    const session = new EditorSession();
    drawRoom(session);
    const outlines = detectOutlines(session.doc, null);
    expect(outlines.length).toBe(1);
    expect(loopSignedArea(outlines[0].grossBoundary)).toBeCloseTo(24, 6);
    // outer wall faces: 6.3 × 4.3
    expect(loopSignedArea(outlines[0].boundary)).toBeCloseTo(6.3 * 4.3, 6);
    expect(outlines[0].boundaryWallIds.length).toBe(4);
  });

  test('interior partitions do not change the outline', () => {
    const session = new EditorSession();
    drawRoom(session);
    addWall(session, 2, 0, 2, 4);
    const outlines = detectOutlines(session.doc, null);
    expect(outlines.length).toBe(1);
    expect(loopSignedArea(outlines[0].boundary)).toBeCloseTo(6.3 * 4.3, 6);
  });
});

describe('ROOF.AUTO — one dispatch roofs the building', () => {
  test('footprint = outer faces + overhang, eaves on the wall tops, regenerated', () => {
    const session = new EditorSession();
    drawRoom(session);
    const first = session.dispatch<{ removed: number; created: number; planArea: number }>(
      'ROOF.AUTO',
      { slope: 15 },
    );
    expect(first.removed).toBe(0);
    expect(first.created).toBe(1);
    expect(first.planArea).toBeCloseTo(6.9 * 4.9, 6); // 0.15 + 0.3 out per side

    const roof = session.doc.all().find((e): e is RoofEntity => e instanceof RoofEntity)!;
    expect(roof.eavesHeight).toBeCloseTo(3, 9); // tallest wall
    // wider than tall → fall across y (the narrow span)
    expect(roof.direction.x).toBeCloseTo(0, 9);
    const { max } = zRange(roof.toMesh('medium'));
    expect(max).toBeCloseTo(3 + Math.tan((15 * Math.PI) / 180) * 4.9, 6);

    const second = session.dispatch<{ removed: number; created: number }>('ROOF.AUTO', {});
    expect(second.removed).toBe(1);
    expect(second.created).toBe(1);
  });

  test('detached buildings each get their own roof', () => {
    const session = new EditorSession();
    drawRoom(session);
    drawRoom(session, 20);
    const result = session.dispatch<{ created: number }>('ROOF.AUTO', {});
    expect(result.created).toBe(2);
  });

  test('quantities report slope area and volume', () => {
    const session = new EditorSession();
    drawRoom(session);
    session.dispatch('ROOF.AUTO', { slope: 15 });
    const report = computeQuantities(session.doc);
    const plan = 6.9 * 4.9;
    expect(report.totals.roofSlopeArea).toBeCloseTo(plan / Math.cos((15 * Math.PI) / 180), 5);
    expect(report.totals.roofVolume).toBeCloseTo(plan * 0.25, 5);
  });
});
