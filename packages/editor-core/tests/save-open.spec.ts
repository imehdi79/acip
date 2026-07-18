import { describe, expect, test } from 'bun:test';
import { EditorSession, WallEntity, point } from '../src/index.js';
import type { EntityId } from '../src/index.js';

function buildSample(session: EditorSession): {
  wallId: EntityId;
  winId: EntityId;
} {
  const levelId = session.dispatch('LEVEL.ADD', {
    name: 'Ground',
    elevation: 0,
  });
  const wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(8, 0),
    levelId,
  });
  const winId = session.dispatch<EntityId>('WINDOW.ADD', {
    wallId,
    t: 0.5,
    width: 1.5,
  });
  return { wallId, winId };
}

describe('EditorSession save/open — in-place document replacement', () => {
  test('open() restores a saved document into the SAME doc instance', () => {
    const source = new EditorSession();
    const { wallId, winId } = buildSample(source);
    const data = source.save();

    const target = new EditorSession();
    const docRef = target.doc;
    target.dispatch('LINE.ADD', { a: point(0, 0), b: point(1, 1) }); // pre-existing junk
    target.open(data);

    expect(target.doc).toBe(docRef); // same instance — viewport references stay valid
    expect(target.doc.count).toBe(2);
    expect(target.doc.get(wallId)).toBeInstanceOf(WallEntity);
    expect(target.doc.relations.dependentsOf(wallId)).toEqual([winId]);
    expect(target.doc.levels.list().map((l) => l.name)).toEqual(['Ground']);
    // derived geometry works: the window still cuts the wall plan
    expect(target.doc.get(wallId)!.getEffectiveGeometry().kind).toBe('group');
  });

  test('open() clears history and selection; load event fires once', () => {
    const session = new EditorSession();
    buildSample(session);
    const data = session.save();

    session.dispatch('LINE.ADD', { a: point(0, 0), b: point(2, 0) });
    session.selection.add(session.doc.all()[0].id);
    let loadEvents = 0;
    session.doc.events.on('change', (e) => {
      if (e.kind === 'load') loadEvents += 1;
    });

    session.open(data);
    expect(session.history.canUndo).toBe(false);
    expect(session.selection.list()).toEqual([]);
    expect(loadEvents).toBe(1);
    // editing continues normally after open
    session.dispatch('WALL.ADD', { a: point(0, 5), b: point(5, 5) });
    expect(session.doc.count).toBe(3);
    expect(session.history.canUndo).toBe(true);
  });

  test('newDocument() wipes content and reseeds only the default layer', () => {
    const session = new EditorSession();
    buildSample(session);
    session.dispatch('MATERIAL.ADD', { name: 'Brick' });
    session.newDocument();

    expect(session.doc.count).toBe(0);
    expect(session.doc.relations.all()).toEqual([]);
    expect(session.doc.levels.list()).toEqual([]);
    expect(session.doc.materials.list()).toEqual([]);
    expect(session.doc.layersList()).toHaveLength(1);
    expect(session.history.canUndo).toBe(false);
  });

  test('round-trip preserves quantities-relevant data (types, materials)', () => {
    const session = new EditorSession();
    const mat = session.dispatch('MATERIAL.ADD', { name: 'Block', unit: 'm3' });
    const typeId = session.dispatch('TYPE.ADD', {
      targetType: 'wall',
      name: 'B200',
      layers: [{ materialId: mat, thickness: 0.2 }],
    });
    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(4, 0), typeId });
    const data = JSON.parse(JSON.stringify(session.save())); // through real JSON

    const restored = new EditorSession();
    restored.open(data);
    const wall = restored.doc.all()[0] as WallEntity;
    expect(wall.getThickness()).toBeCloseTo(0.2); // thickness derives from restored catalog
  });
});
