import { describe, expect, test } from 'bun:test';
import {
  DoorEntity,
  EditorSession,
  LineEntity,
  ValidationError,
  WallEntity,
  WindowEntity,
  bboxCenter,
  hasGrips,
  point,
} from '../src/index.js';
import type { EntityId, GroupShape, SegmentShape } from '../src/index.js';

function addWall(
  session: EditorSession,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
  });
}

describe('grips', () => {
  test('line endpoint grip stretches the line, undo restores', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('LINE.ADD', {
      a: point(0, 0),
      b: point(10, 0),
    });
    const line = session.doc.get(id) as LineEntity;
    expect(hasGrips(line)).toBe(true);
    expect(line.getGrips()).toHaveLength(2);

    session.dispatch('GRIP.MOVE', { id, index: 1, to: point(10, 5) });
    expect((line.getBaseGeometry() as SegmentShape).b).toEqual({ x: 10, y: 5 });

    session.undo();
    expect((line.getBaseGeometry() as SegmentShape).b).toEqual({ x: 10, y: 0 });
  });

  test('stretching a wall grip carries its window parametrically', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });

    // stretch the far end from x=10 to x=20 — window stays at t=0.5 → x=10
    session.dispatch('GRIP.MOVE', { id: wallId, index: 1, to: point(20, 0) });
    const wall = session.doc.get(wallId) as WallEntity;
    expect(wall.getLength()).toBeCloseTo(20);
    const center = bboxCenter(session.doc.get(winId)!.getBounds());
    expect(center.x).toBeCloseTo(10);

    session.undo();
    expect(bboxCenter(session.doc.get(winId)!.getBounds()).x).toBeCloseTo(5);
  });

  test('window grip slides it along the wall', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });

    session.dispatch('GRIP.MOVE', { id: winId, index: 0, to: point(8, 3) });
    const win = session.doc.get(winId) as WindowEntity;
    expect(win.t).toBeCloseTo(0.8);
    expect(bboxCenter(win.getBounds()).y).toBeCloseTo(0);
  });

  test('GRIP.MOVE on a gripless target is rejected and rolls back', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('GRIP.MOVE', { id: 'nope', index: 0, to: point(0, 0) }),
    ).toThrow(ValidationError);
    expect(session.history.canUndo).toBe(false);
  });

  test('OPENING.MOVE slides a window to the given t; undoable', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });

    session.dispatch('OPENING.MOVE', { id: winId, t: 0.25 });
    const win = session.doc.get(winId) as WindowEntity;
    expect(win.t).toBeCloseTo(0.25);
    expect(bboxCenter(win.getBounds()).x).toBeCloseTo(2.5);

    session.undo();
    expect((session.doc.get(winId) as WindowEntity).t).toBeCloseTo(0.5);
  });

  test('OPENING.RESIZE sets the width; undoable; rejects non-openings', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });

    session.dispatch('OPENING.RESIZE', { id: winId, width: 2 });
    expect((session.doc.get(winId) as WindowEntity).width).toBeCloseTo(2);

    session.undo();
    const prev = (session.doc.get(winId) as WindowEntity).width;
    expect(prev).not.toBeCloseTo(2);

    expect(() =>
      session.dispatch('OPENING.RESIZE', { id: wallId, width: 1 }),
    ).toThrow(ValidationError);
  });

  test('OPENING.MOVE rejects non-openings and out-of-range t', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const winId = session.dispatch<EntityId>('WINDOW.ADD', { wallId, t: 0.5 });
    expect(() =>
      session.dispatch('OPENING.MOVE', { id: wallId, t: 0.25 }),
    ).toThrow(ValidationError);
    expect(() =>
      session.dispatch('OPENING.MOVE', { id: winId, t: 1.5 }),
    ).toThrow(ValidationError);
  });

  test('ENTITY.MOVE and ENTITY.ERASE reject unknown ids loudly', () => {
    // a silent "moved 0" reads as success to an agent — the retry-loop trap
    const session = new EditorSession();
    expect(() =>
      session.dispatch('ENTITY.MOVE', { ids: ['ghost'], delta: point(1, 0) }),
    ).toThrow(/unknown entity ids/);
    expect(() => session.dispatch('ENTITY.ERASE', { ids: ['ghost'] })).toThrow(
      /unknown entity ids/,
    );
    expect(session.history.canUndo).toBe(false);
  });
});

describe('DoorEntity', () => {
  test('DOOR.ADD cuts the wall to the floor and draws a swing symbol', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const doorId = session.dispatch<EntityId>('DOOR.ADD', {
      wallId,
      t: 0.3,
      width: 1,
    });

    const door = session.doc.get(doorId) as DoorEntity;
    expect(door.getOpeningSpec().sill).toBe(0);
    // wall area loses the full opening width
    expect(session.measure.areaOf(wallId)).toBeCloseTo((10 - 1) * 0.3);

    // plan symbol: leaf segment + quarter swing arc
    const symbol = door.getBaseGeometry() as GroupShape;
    expect(symbol.kind).toBe('group');
    const kinds = symbol.children.map((c) => c.kind).sort();
    expect(kinds).toEqual(['arc', 'segment']);
  });

  test('door mesh opening reaches the floor (no sill band in wall mesh)', () => {
    const withDoor = new EditorSession();
    const wallA = addWall(withDoor, 0, 0, 10, 0);
    withDoor.dispatch('DOOR.ADD', { wallId: wallA, t: 0.5, width: 1 });

    const withWindow = new EditorSession();
    const wallB = addWall(withWindow, 0, 0, 10, 0);
    withWindow.dispatch('WINDOW.ADD', { wallId: wallB, t: 0.5, width: 1 });

    const doorMesh = (withDoor.doc.get(wallA) as WallEntity).toMesh('medium');
    const windowMesh = (withWindow.doc.get(wallB) as WallEntity).toMesh(
      'medium',
    );
    // window wall has an extra sill band → more vertices than the door wall
    expect(windowMesh.positions.length).toBeGreaterThan(
      doorMesh.positions.length,
    );
  });

  test('doors round-trip through save/load', () => {
    const session = new EditorSession();
    const wallId = addWall(session, 0, 0, 10, 0);
    const doorId = session.dispatch<EntityId>('DOOR.ADD', {
      wallId,
      t: 0.25,
      width: 0.9,
      swing: -1,
    });
    const data = (session.doc.get(doorId) as DoorEntity).saveData();
    const restored = session.entityTypes.restore(data) as DoorEntity;
    expect(restored.t).toBeCloseTo(0.25);
    expect(restored.swing).toBe(-1);
  });
});
