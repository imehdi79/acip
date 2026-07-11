import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  ValidationError,
  WallEntity,
  loadDocument,
  point,
  saveDocument,
} from '../src/index.js';
import type { DocumentChangeEvent, EntityId, LevelId } from '../src/index.js';

function addWall(session: EditorSession, levelId?: LevelId) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(10, 0),
    thickness: 0.3,
    height: 3,
    ...(levelId ? { levelId } : {}),
  });
}

describe('transactional document stores', () => {
  test('LEVEL.ADD is undoable and redoable', () => {
    const session = new EditorSession();
    const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'Level 2', elevation: 3 });
    expect(session.doc.levels.get(levelId)?.name).toBe('Level 2');

    session.undo();
    expect(session.doc.levels.get(levelId)).toBeNull();

    session.redo();
    expect(session.doc.levels.get(levelId)?.elevation).toBe(3);
  });

  test('LEVEL.UPDATE snapshots before/after; undo restores the old elevation', () => {
    const session = new EditorSession();
    const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    session.dispatch('LEVEL.UPDATE', { id: levelId, elevation: 3.5 });
    expect(session.doc.levels.get(levelId)?.elevation).toBe(3.5);

    session.undo();
    expect(session.doc.levels.get(levelId)?.elevation).toBe(3);
  });

  test('LAYER.ADD is undoable', () => {
    const session = new EditorSession();
    const layerId = session.dispatch('LAYER.ADD', { name: 'walls' });
    expect(session.doc.layersList().map((l) => l.name)).toContain('walls');
    session.undo();
    expect(session.doc.layersList().map((l) => l.name)).not.toContain('walls');
    expect(session.doc.getLayer(layerId as never)).toBeNull();
  });

  test('a failing command rolls back store changes too', () => {
    const session = new EditorSession();
    // LEVEL.UPDATE on a missing level throws inside execute, after nothing else
    expect(() =>
      session.dispatch('LEVEL.UPDATE', { id: 'missing', elevation: 1 }),
    ).toThrow();
    expect(session.history.canUndo).toBe(false);
    expect(session.doc.levels.list()).toHaveLength(0);
  });
});

describe('levels in the model', () => {
  test('a wall on a level extrudes at that elevation', () => {
    const session = new EditorSession();
    const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    const wallId = addWall(session, levelId);
    const mesh = (session.doc.get(wallId) as WallEntity).toMesh('medium');
    const zs: number[] = [];
    for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]);
    expect(Math.min(...zs)).toBeCloseTo(3);
    expect(Math.max(...zs)).toBeCloseTo(6);
  });

  test('raising a level marks its walls dirty (3D moves with the datum)', () => {
    const session = new EditorSession();
    const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    const wallId = addWall(session, levelId);

    const events: DocumentChangeEvent[] = [];
    session.doc.events.on('change', (e) => events.push(e));
    session.dispatch('LEVEL.UPDATE', { id: levelId, elevation: 4 });

    // the wall itself is touched → it appears in the change's recompute scope
    const record = events[0].record;
    expect(record.changes.stores).toHaveLength(1);
    const mesh = (session.doc.get(wallId) as WallEntity).toMesh('medium');
    const zs: number[] = [];
    for (let i = 2; i < mesh.positions.length; i += 3) zs.push(mesh.positions[i]);
    expect(Math.min(...zs)).toBeCloseTo(4);
  });

  test('LEVEL.REMOVE is blocked while entities reference it', () => {
    const session = new EditorSession();
    const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    const wallId = addWall(session, levelId);

    expect(() => session.dispatch('LEVEL.REMOVE', { id: levelId })).toThrow(ValidationError);
    expect(session.doc.levels.get(levelId)).not.toBeNull();

    session.dispatch('ENTITY.ERASE', { ids: [wallId] });
    session.dispatch('LEVEL.REMOVE', { id: levelId });
    expect(session.doc.levels.get(levelId)).toBeNull();
  });

  test('levels round-trip through save/load', () => {
    const session = new EditorSession();
    const levelId = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L2', elevation: 3 });
    addWall(session, levelId);

    const data = JSON.parse(JSON.stringify(saveDocument(session.doc)));
    const restored = loadDocument(data, session.entityTypes);
    expect(restored.levels.get(levelId)?.elevation).toBe(3);
    expect(restored.count).toBe(1);
  });
});
