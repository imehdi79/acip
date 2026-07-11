import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  WindowEntity,
  bboxCenter,
  loadDocument,
  point,
  saveDocument,
  subtractIntervals,
} from '../src/index.js';
import type { DocumentChangeEvent, EntityId } from '../src/index.js';

function addWall(session: EditorSession, ax: number, ay: number, bx: number, by: number) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });
}

describe('subtractIntervals', () => {
  test('complement of merged cuts, clamped to range', () => {
    expect(subtractIntervals(10, [{ start: 4, end: 6 }])).toEqual([
      { start: 0, end: 4 },
      { start: 6, end: 10 },
    ]);
    expect(subtractIntervals(10, [{ start: -1, end: 1 }])).toEqual([{ start: 1, end: 10 }]);
    expect(
      subtractIntervals(10, [
        { start: 2, end: 5 },
        { start: 4, end: 7 },
      ]),
    ).toEqual([
      { start: 0, end: 2 },
      { start: 7, end: 10 },
    ]);
    expect(subtractIntervals(10, [{ start: 0, end: 10 }])).toEqual([]);
  });
});

describe('WallEntity', () => {
  test('WALL.ADD creates a wall with region geometry and correct area', () => {
    const session = new EditorSession();
    const id = addWall(session, 0, 0, 10, 0);
    const wall = session.doc.get(id);
    expect(wall).toBeInstanceOf(WallEntity);
    expect(wall!.getEffectiveGeometry().kind).toBe('region');
    expect(session.measure.areaOf(id)).toBeCloseTo(3.0); // 10m × 0.3m
  });

  test('wall extrudes to a mesh', () => {
    const session = new EditorSession();
    const id = addWall(session, 0, 0, 10, 0);
    const wall = session.doc.get(id) as WallEntity;
    const mesh = wall.toMesh('medium');
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
    // all z coordinates within [0, height]
    for (let i = 2; i < mesh.positions.length; i += 3) {
      expect(mesh.positions[i]).toBeGreaterThanOrEqual(0);
      expect(mesh.positions[i]).toBeLessThanOrEqual(3);
    }
  });
});

describe('WindowEntity — hosted placement and openings', () => {
  test('WINDOW.ADD attaches to the wall and cuts the plan geometry', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5, width: 2 });

    expect(session.doc.relations.dependentsOf(wallId)).toEqual([winId]);

    const wall = session.doc.get(wallId) as WallEntity;
    const effective = wall.getEffectiveGeometry();
    expect(effective.kind).toBe('group'); // two solid spans
    expect(session.measure.areaOf(wallId)).toBeCloseTo((10 - 2) * 0.3);

    // window sits at the wall's midpoint — derived, never stored
    const center = bboxCenter(session.doc.get(winId)!.getBounds());
    expect(center.x).toBeCloseTo(5);
    expect(center.y).toBeCloseTo(0);
  });

  test('opening clamps at the wall end', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    session.dispatch('WINDOW.ADD', { wallId, t: 0, width: 2 });
    expect(session.measure.areaOf(wallId)).toBeCloseTo(9 * 0.3);
  });

  test('moving the wall carries the window (recompute), and dirty reports it', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });

    const events: DocumentChangeEvent[] = [];
    session.doc.events.on('change', (e) => events.push(e));
    session.dispatch('ENTITY.MOVE', { ids: [wallId], delta: point(0, 2) });

    expect(events[0].dirty).toContain(winId);
    const center = bboxCenter(session.doc.get(winId)!.getBounds());
    expect(center.x).toBeCloseTo(5);
    expect(center.y).toBeCloseTo(2);
  });

  test('moving a window slides it along the wall axis', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });

    // delta has a y component but the window stays on the axis
    session.dispatch('ENTITY.MOVE', { ids: [winId], delta: point(2, 5) });
    const win = session.doc.get(winId) as WindowEntity;
    expect(win.t).toBeCloseTo(0.7);
    const center = bboxCenter(win.getBounds());
    expect(center.x).toBeCloseTo(7);
    expect(center.y).toBeCloseTo(0);
  });

  test('erasing the wall cascades; one undo restores wall, window, and relation', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.3 });

    session.dispatch('ENTITY.ERASE', { ids: [wallId] });
    expect(session.doc.count).toBe(0);
    expect(session.doc.relations.all()).toHaveLength(0);

    session.undo();
    expect(session.doc.count).toBe(2);
    expect(session.doc.relations.dependentsOf(wallId)).toEqual([winId]);
    expect(session.measure.areaOf(wallId)).toBeCloseTo((10 - 1) * 0.3);
  });

  test('undoing WINDOW.ADD restores the solid wall', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    session.dispatch('WINDOW.ADD', { wallId, t: 0.5 });
    expect(session.measure.areaOf(wallId)).toBeCloseTo(9 * 0.3);
    session.undo();
    expect(session.doc.count).toBe(1);
    expect(session.measure.areaOf(wallId)).toBeCloseTo(3.0);
  });

  test('wall mesh gains opening bands; window contributes a pane', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId,
      t: 0.5,
      width: 2,
      sill: 0.9,
      height: 1.2,
    });
    const wall = session.doc.get(wallId) as WallEntity;
    const solid = new EditorSession();
    const solidWallId = addWall(solid, 0, 0, 10, 0);
    const solidMesh = (solid.doc.get(solidWallId) as WallEntity).toMesh('medium');
    const cutMesh = wall.toMesh('medium');
    // spans + sill band + lintel band → more geometry than the solid wall
    expect(cutMesh.positions.length).toBeGreaterThan(solidMesh.positions.length);

    const pane = (session.doc.get(winId) as WindowEntity).toMesh('medium');
    expect(pane.positions.length).toBeGreaterThan(0);
    // pane z range = [sill, sill + height]
    const zs: number[] = [];
    for (let i = 2; i < pane.positions.length; i += 3) zs.push(pane.positions[i]);
    expect(Math.min(...zs)).toBeCloseTo(0.9);
    expect(Math.max(...zs)).toBeCloseTo(2.1);
  });

  test('document round-trips with wall, window, and relation intact', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.25, width: 2 });

    const data = JSON.parse(JSON.stringify(saveDocument(session.doc)));
    const restored = loadDocument(data, session.entityTypes);

    expect(restored.count).toBe(2);
    expect(restored.relations.dependentsOf(wallId)).toEqual([winId]);
    const center = bboxCenter(restored.get(winId)!.getBounds());
    expect(center.x).toBeCloseTo(2.5);
  });
});
