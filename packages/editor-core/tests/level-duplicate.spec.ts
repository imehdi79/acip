import { describe, expect, test } from 'bun:test';
import { EditorSession, WallEntity, computeQuantities, point } from '../src/index.js';
import type { EntityId, LevelId } from '../src/index.js';

function buildFloor(session: EditorSession): { levelId: LevelId; wallId: EntityId } {
  const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'Ground', elevation: 0 });
  const wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(8, 0),
    levelId,
  });
  session.dispatch('WALL.ADD', { a: point(0, 0), b: point(0, 5), levelId });
  session.dispatch('WINDOW.ADD', { wallId, t: 0.5, width: 1.5 });
  session.dispatch('DOOR.ADD', { wallId, t: 0.2 });
  return { levelId, wallId };
}

describe('LEVEL.DUPLICATE — copy floor to floor', () => {
  test('clones entities and hosted openings onto the new level', () => {
    const session = new EditorSession();
    const { levelId } = buildFloor(session);
    expect(session.doc.count).toBe(4); // 2 walls + window + door

    const upper = session.dispatch<LevelId>('LEVEL.DUPLICATE', {
      sourceLevelId: levelId,
      name: 'First',
      elevation: 3,
    });

    expect(session.doc.count).toBe(8);
    expect(session.doc.levels.get(upper)!.elevation).toBe(3);

    const upperWalls = session.doc
      .all()
      .filter((e): e is WallEntity => e instanceof WallEntity && e.baseLevelId === upper);
    expect(upperWalls).toHaveLength(2);

    // the cloned host carries its own cloned openings with placements intact
    const hostedIds = upperWalls.flatMap((w) => session.doc.relations.dependentsOf(w.id));
    expect(hostedIds).toHaveLength(2);
    const types = hostedIds.map((id) => session.doc.get(id)!.type).sort();
    expect(types).toEqual(['door', 'window']);

    // 3D actually sits at the new elevation
    const mesh = upperWalls[0].toMesh('medium');
    let minZ = Infinity;
    for (let i = 2; i < mesh.positions.length; i += 3) minZ = Math.min(minZ, mesh.positions[i]);
    expect(minZ).toBeCloseTo(3);

    // quantities double
    const report = computeQuantities(session.doc);
    expect(report.totals.windowCount).toBe(2);
    expect(report.totals.doorCount).toBe(2);
    expect(report.totals.wallLength).toBeCloseTo(26);
  });

  test('one undo removes the whole duplicated floor', () => {
    const session = new EditorSession();
    const { levelId } = buildFloor(session);
    session.dispatch('LEVEL.DUPLICATE', { sourceLevelId: levelId, name: 'First', elevation: 3 });

    session.undo();
    expect(session.doc.count).toBe(4);
    expect(session.doc.levels.list()).toHaveLength(1);
    session.redo();
    expect(session.doc.count).toBe(8);
    expect(session.doc.levels.list()).toHaveLength(2);
  });

  test('rejects a missing source level', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('LEVEL.DUPLICATE', {
        sourceLevelId: 'nope',
        name: 'X',
        elevation: 3,
      }),
    ).toThrow('does not exist');
  });
});
