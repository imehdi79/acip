import { describe, expect, test } from 'bun:test';
import { DimensionEntity, EditorSession, point } from '../src/index.js';
import type { EntityId, Geometry, LevelId, TextShape } from '../src/index.js';

function addWall(
  session: EditorSession,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  thickness = 0.3,
): EntityId {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness,
    height: 3,
  });
}

/** 6×4 room of 0.3 m walls drawn to centerlines, counter-clockwise */
function drawRoom(session: EditorSession): EntityId[] {
  return [
    addWall(session, 0, 0, 6, 0),
    addWall(session, 6, 0, 6, 4),
    addWall(session, 6, 4, 0, 4),
    addWall(session, 0, 4, 0, 0),
  ];
}

function findText(g: Geometry): TextShape | null {
  if (g.kind === 'text') return g;
  if (g.kind === 'group') {
    for (const child of g.children) {
      const found = findText(child);
      if (found) return found;
    }
  }
  return null;
}

describe('DimensionEntity — value is derived, never stored', () => {
  test('points mode measures the distance and renders it as text', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('DIM.ADD', {
      a: point(0, 0),
      b: point(3, 4),
      offset: 0.5,
    });
    const dim = session.doc.get(id) as DimensionEntity;
    expect(dim).toBeInstanceOf(DimensionEntity);
    expect(dim.getValue()).toBeCloseTo(5, 9);
    expect(findText(dim.getBaseGeometry())!.text).toBe('5.00');
  });

  test('face-bound dimension measures clear width and follows wall edits', () => {
    const session = new EditorSession();
    const [bottom, , top] = drawRoom(session);
    // both face+ point into the room (left of each baseline's travel)
    const id = session.dispatch<EntityId>('DIM.ADD', {
      wallA: bottom,
      sideA: 'face+',
      wallB: top,
      sideB: 'face+',
      t: 0.5,
    });
    const dim = session.doc.get(id) as DimensionEntity;
    expect(dim.getValue()).toBeCloseTo(3.7, 9); // 4 − 0.15 − 0.15 clear
    // move the far wall — the dimension re-measures with no edit
    session.dispatch('ENTITY.MOVE', { ids: [top], delta: point(0, 0.5) });
    expect(dim.getValue()).toBeCloseTo(4.2, 9);
    session.undo();
    expect(dim.getValue()).toBeCloseTo(3.7, 9);
  });

  test('each wall contributes half its own thickness (the assembly rule)', () => {
    const session = new EditorSession();
    const a = addWall(session, 0, 0, 6, 0, 0.3);
    const b = addWall(session, 6, 4, 0, 4, 0.5);
    const id = session.dispatch<EntityId>('DIM.ADD', {
      wallA: a,
      sideA: 'face+',
      wallB: b,
      sideB: 'face+',
    });
    const dim = session.doc.get(id) as DimensionEntity;
    expect(dim.getValue()).toBeCloseTo(4 - 0.15 - 0.25, 9);
    // axis-to-axis ignores thickness entirely
    const axisId = session.dispatch<EntityId>('DIM.ADD', { wallA: a, wallB: b });
    expect((session.doc.get(axisId) as DimensionEntity).getValue()).toBeCloseTo(4, 9);
  });

  test('erasing a referenced wall leaves the dimension stale, not broken', () => {
    const session = new EditorSession();
    const [bottom, , top] = drawRoom(session);
    const id = session.dispatch<EntityId>('DIM.ADD', {
      wallA: bottom,
      sideA: 'face+',
      wallB: top,
      sideB: 'face+',
    });
    session.dispatch('ENTITY.ERASE', { ids: [top] });
    const dim = session.doc.get(id) as DimensionEntity;
    expect(dim.getValue()).toBeNull();
    expect(dim.hitTest(point(3, 2), 1)).toBe(false);
    const g = dim.getBaseGeometry();
    expect(g.kind === 'group' && g.children.length === 0).toBe(true);
  });

  test('DIM.ADD validates its two modes', () => {
    const session = new EditorSession();
    expect(() => session.dispatch('DIM.ADD', { a: point(0, 0) })).toThrow();
    const wall = addWall(session, 0, 0, 6, 0);
    expect(() => session.dispatch('DIM.ADD', { wallA: wall, wallB: wall, sideA: 'inner' })).toThrow();
    expect(() =>
      session.dispatch('DIM.ADD', { a: point(0, 0), b: point(1, 0), wallA: wall, wallB: wall }),
    ).toThrow();
  });

  test('dimensions round-trip through save/open, references intact', () => {
    const session = new EditorSession();
    const [bottom, , top] = drawRoom(session);
    session.dispatch('DIM.ADD', { wallA: bottom, sideA: 'face+', wallB: top, sideB: 'face+' });
    session.open(session.save());
    const dims = session.doc.all().filter((e) => e instanceof DimensionEntity);
    expect(dims.length).toBe(1);
    expect((dims[0] as DimensionEntity).getValue()).toBeCloseTo(3.7, 9);
  });
});

describe('DIM.AUTO — inner clear widths, outer overall extents', () => {
  test('room + partition: inner dims per room, outer extents, regenerated on re-run', () => {
    const session = new EditorSession();
    drawRoom(session);
    addWall(session, 2, 0, 2, 4);

    const first = session.dispatch<{ removed: number; created: number }>('DIM.AUTO', {});
    expect(first.removed).toBe(0);
    expect(first.created).toBe(6); // 2 per room + 2 outer

    const values = session.doc
      .all()
      .filter((e): e is DimensionEntity => e instanceof DimensionEntity)
      .map((d) => d.getValue()!)
      .sort((a, b) => a - b);
    // inner: left room 1.7 × 3.7, right room 3.7 × 3.7 (clear, face to face)
    // outer: 6.3 × 4.3 (overall, wall thickness included)
    expect(values.map((v) => Number(v.toFixed(2)))).toEqual([1.7, 3.7, 3.7, 3.7, 4.3, 6.3]);

    // regeneration replaces, never accumulates
    const second = session.dispatch<{ removed: number; created: number }>('DIM.AUTO', {});
    expect(second.removed).toBe(6);
    expect(second.created).toBe(6);
    expect(session.doc.all().filter((e) => e instanceof DimensionEntity).length).toBe(6);
    // the whole regeneration is one undo step
    session.undo();
    expect(session.doc.all().filter((e) => e instanceof DimensionEntity).length).toBe(6);
  });

  test('auto dimensions land on the requested level; hand-placed dims survive', () => {
    const session = new EditorSession();
    const level = session.dispatch<LevelId>('LEVEL.ADD', { name: 'L1', elevation: 0 });
    drawRoom(session);
    const manual = session.dispatch<EntityId>('DIM.ADD', { a: point(0, 0), b: point(6, 0) });
    session.dispatch('DIM.AUTO', { levelId: level, outer: false });
    const dims = session.doc
      .all()
      .filter((e): e is DimensionEntity => e instanceof DimensionEntity);
    for (const dim of dims) {
      if (dim.id === manual) continue;
      expect(dim.auto).toBe(true);
      expect(dim.baseLevelId).toBe(level);
    }
    session.dispatch('DIM.AUTO', { levelId: level, outer: false });
    expect(session.doc.has(manual)).toBe(true);
  });
});
