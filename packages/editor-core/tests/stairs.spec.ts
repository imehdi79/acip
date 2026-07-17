import { describe, expect, test } from 'bun:test';
import { EditorSession, StairEntity, computeQuantities, point } from '../src/index.js';
import type { EntityId, LevelId } from '../src/index.js';

describe('StairEntity — derived flight from the rise', () => {
  test('riser count keeps the actual riser under the max; run derives from it', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('STAIR.ADD', {
      origin: point(0, 0),
      direction: point(1, 0),
      height: 3, // flat 3 m rise
    });
    const stair = session.doc.get(id) as StairEntity;
    expect(stair).toBeInstanceOf(StairEntity);
    expect(stair.getRise()).toBeCloseTo(3, 9);
    expect(stair.getRiserCount()).toBe(16); // ceil(3 / 0.19)
    expect(stair.getRiser()).toBeCloseTo(3 / 16, 9);
    expect(stair.getRiser()).toBeLessThanOrEqual(0.19 + 1e-9);
    expect(stair.getRunLength()).toBeCloseTo(16 * 0.28, 9);
  });

  test('a stair spans two levels and re-treads when the top level moves', () => {
    const session = new EditorSession();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L1', elevation: 0 });
    const l2 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 2.8 });
    const id = session.dispatch<EntityId>('STAIR.ADD', {
      origin: point(0, 0),
      baseLevelId: l1,
      topLevelId: l2,
    });
    const stair = session.doc.get(id) as StairEntity;
    expect(stair.getRise()).toBeCloseTo(2.8, 9);
    const before = stair.getRiserCount();

    // raise the top level — the stair re-treads without an edit
    session.dispatch('LEVEL.UPDATE', { id: l2, elevation: 3.6 });
    expect(stair.getRise()).toBeCloseTo(3.6, 9);
    expect(stair.getRiserCount()).toBeGreaterThan(before);
  });

  test('a change to the TOP level dirties the stair (cross-level relation)', () => {
    const session = new EditorSession();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L1', elevation: 0 });
    const l2 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    const id = session.dispatch<EntityId>('STAIR.ADD', {
      origin: point(0, 0),
      baseLevelId: l1,
      topLevelId: l2,
    });
    let dirtyIds: readonly EntityId[] = [];
    session.doc.events.on('change', (e) => (dirtyIds = e.dirty));
    session.dispatch('LEVEL.UPDATE', { id: l2, elevation: 3.3 });
    expect(dirtyIds).toContain(id);
  });

  test('LEVEL.REMOVE is blocked while a stair uses the level as its top', () => {
    const session = new EditorSession();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L1', elevation: 0 });
    const l2 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    session.dispatch('STAIR.ADD', { origin: point(0, 0), baseLevelId: l1, topLevelId: l2 });
    expect(() => session.dispatch('LEVEL.REMOVE', { id: l2 })).toThrow();
  });

  test('the 3D mesh climbs from the base elevation to the rise', () => {
    const session = new EditorSession();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L1', elevation: 3 });
    const id = session.dispatch<EntityId>('STAIR.ADD', {
      origin: point(0, 0),
      baseLevelId: l1,
      height: 3,
    });
    const stair = session.doc.get(id) as StairEntity;
    const mesh = stair.toMesh('medium');
    expect(mesh.indices.length % 3).toBe(0);
    let min = Infinity;
    let max = -Infinity;
    for (let i = 2; i < mesh.positions.length; i += 3) {
      min = Math.min(min, mesh.positions[i]);
      max = Math.max(max, mesh.positions[i]);
    }
    expect(min).toBeCloseTo(3, 6); // base elevation
    expect(max).toBeCloseTo(6, 6); // + 3 m rise
  });

  test('validates its levels and round-trips through save/open', () => {
    const session = new EditorSession();
    expect(() => session.dispatch('STAIR.ADD', { origin: point(0, 0), topLevelId: 'ghost' })).toThrow();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L1', elevation: 0 });
    const l2 = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    session.dispatch('STAIR.ADD', {
      origin: point(1, 2),
      direction: point(0, 1),
      baseLevelId: l1,
      topLevelId: l2,
    });
    session.open(session.save());
    const stairs = session.doc.all().filter((e): e is StairEntity => e instanceof StairEntity);
    expect(stairs.length).toBe(1);
    expect(stairs[0].getRise()).toBeCloseTo(3, 9);
    expect(computeQuantities(session.doc).totals.stairCount).toBe(1);
  });
});
