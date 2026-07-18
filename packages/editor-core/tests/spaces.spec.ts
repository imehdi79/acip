import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  arrangeSegments,
  describeDocument,
  detectSpaces,
  loopSignedArea,
  point,
  pointInLoop,
} from '../src/index.js';
import type {
  ArrangementSegment,
  EntityId,
  JsonObject,
  LevelId,
  Point,
} from '../src/index.js';

const TOL = 1e-4;

function seg(
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  halfWidth = 0,
): ArrangementSegment {
  return { id, a: point(ax, ay), b: point(bx, by), halfWidth };
}

/** 6×4 rectangle of baselines, counter-clockwise */
function rect(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  prefix = 'w',
): ArrangementSegment[] {
  return [
    seg(`${prefix}-bottom`, x0, y0, x1, y0),
    seg(`${prefix}-right`, x1, y0, x1, y1),
    seg(`${prefix}-top`, x1, y1, x0, y1),
    seg(`${prefix}-left`, x0, y1, x0, y0),
  ];
}

describe('arrangeSegments — planar arrangement', () => {
  test('closed rectangle yields one face with the enclosed area', () => {
    const faces = arrangeSegments(rect(0, 0, 6, 4), TOL);
    expect(faces.length).toBe(1);
    expect(faces[0].area).toBeCloseTo(24, 9);
    expect(faces[0].edges.length).toBe(4);
    expect(faces[0].holes.length).toBe(0);
  });

  test('partition tee`d mid-span splits one room into two — at any parameter', () => {
    // partition at x = 2 (1/3 along the 6 m walls, NOT the midpoint)
    const faces = arrangeSegments(
      [...rect(0, 0, 6, 4), seg('partition', 2, 0, 2, 4)],
      TOL,
    );
    const areas = faces.map((f) => f.area).sort((a, b) => a - b);
    expect(faces.length).toBe(2);
    expect(areas[0]).toBeCloseTo(8, 9);
    expect(areas[1]).toBeCloseTo(16, 9);
  });

  test('partition drawn flush to host FACES still connects (halfWidth allowance)', () => {
    // hosts are 0.3 m walls; partition endpoints stop at their faces (y 0.15 / 3.85)
    const walls = rect(0, 0, 6, 4).map((s) => ({ ...s, halfWidth: 0.15 }));
    const faces = arrangeSegments(
      [...walls, seg('partition', 2, 0.15, 2, 3.85, 0.15)],
      TOL,
    );
    const areas = faces.map((f) => f.area).sort((a, b) => a - b);
    expect(faces.length).toBe(2);
    expect(areas[0]).toBeCloseTo(8, 6);
    expect(areas[1]).toBeCloseTo(16, 6);
  });

  test('crossing partitions (X) split each other into four quadrants', () => {
    const faces = arrangeSegments(
      [...rect(0, 0, 4, 4), seg('h', 0, 2, 4, 2), seg('v', 2, 0, 2, 4)],
      TOL,
    );
    expect(faces.length).toBe(4);
    for (const face of faces) expect(face.area).toBeCloseTo(4, 9);
  });

  test('dangling stub traverses as a spike without changing the area', () => {
    const faces = arrangeSegments(
      [...rect(0, 0, 6, 4), seg('stub', 0, 2, 1, 2)],
      TOL,
    );
    expect(faces.length).toBe(1);
    expect(faces[0].area).toBeCloseTo(24, 9);
    // the walk visits the stub tip (out and back)
    expect(
      faces[0].loop.some(
        (p) => Math.abs(p.x - 1) < TOL && Math.abs(p.y - 2) < TOL,
      ),
    ).toBe(true);
  });

  test('detached island becomes a hole of the containing face', () => {
    const faces = arrangeSegments(
      [...rect(0, 0, 10, 10), ...rect(4, 4, 6, 6, 'island')],
      TOL,
    );
    const byArea = [...faces].sort((a, b) => a.area - b.area);
    expect(faces.length).toBe(2);
    // island interior is itself a bounded face
    expect(byArea[0].area).toBeCloseTo(4, 9);
    expect(byArea[0].holes.length).toBe(0);
    // outer room loses the island footprint and gains its contour as a hole
    expect(byArea[1].area).toBeCloseTo(96, 9);
    expect(byArea[1].holes.length).toBe(1);
  });

  test('a gap wider than the tolerance keeps the region open', () => {
    const open = [
      seg('bottom', 0, 0, 6, 0),
      seg('right', 6, 0, 6, 4),
      seg('top', 6, 4, 0, 4),
      seg('left', 0, 4, 0, 0.005), // 5 mm short of closing
    ];
    expect(arrangeSegments(open, TOL).length).toBe(0);
  });

  test('loopSignedArea and pointInLoop agree on orientation and containment', () => {
    const square: Point[] = [
      point(0, 0),
      point(2, 0),
      point(2, 2),
      point(0, 2),
    ];
    expect(loopSignedArea(square)).toBeCloseTo(4, 12);
    expect(pointInLoop(point(1, 1), square)).toBe(true);
    expect(pointInLoop(point(3, 1), square)).toBe(false);
  });
});

function addWall(
  session: EditorSession,
  ax: number,
  ay: number,
  bx: number,
  by: number,
  levelId?: LevelId,
): EntityId {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
    ...(levelId ? { levelId } : {}),
  });
}

/** 6×4 room of 0.3 m walls drawn to centerlines */
function drawRoom(session: EditorSession, levelId?: LevelId): EntityId[] {
  return [
    addWall(session, 0, 0, 6, 0, levelId),
    addWall(session, 6, 0, 6, 4, levelId),
    addWall(session, 6, 4, 0, 4, levelId),
    addWall(session, 0, 4, 0, 0, levelId),
  ];
}

describe('detectSpaces — derived rooms', () => {
  test('closed room reports gross (centerline) and net (inner face) areas', () => {
    const session = new EditorSession();
    drawRoom(session);
    const spaces = detectSpaces(session.doc, null);
    expect(spaces.length).toBe(1);
    const room = spaces[0];
    expect(room.grossArea).toBeCloseTo(24, 6); // 6 × 4 centerline
    expect(room.netArea).toBeCloseTo(5.7 * 3.7, 6); // 0.15 in from every wall
    expect(room.boundaryWallIds.length).toBe(4);
    // label lands inside the net boundary
    expect(pointInLoop(room.labelPoint, room.boundary)).toBe(true);
  });

  test('a tee`d partition subdivides automatically; erase it and rooms merge', () => {
    const session = new EditorSession();
    drawRoom(session);
    const partition = addWall(session, 2, 0, 2, 4);
    const spaces = detectSpaces(session.doc, null);
    expect(spaces.length).toBe(2);
    const nets = spaces.map((s) => s.netArea).sort((a, b) => a - b);
    expect(nets[0]).toBeCloseTo(1.7 * 3.7, 6); // 2 − 0.15 − 0.15 wide
    expect(nets[1]).toBeCloseTo(3.7 * 3.7, 6); // 4 − 0.15 − 0.15 wide
    session.dispatch('ENTITY.ERASE', { ids: [partition] });
    expect(detectSpaces(session.doc, null).length).toBe(1);
  });

  test('L-shaped room: reflex corner resolves and the label stays inside', () => {
    const session = new EditorSession();
    // 6×4 outline with a 3×2 notch cut from the top-right
    addWall(session, 0, 0, 6, 0);
    addWall(session, 6, 0, 6, 2);
    addWall(session, 6, 2, 3, 2);
    addWall(session, 3, 2, 3, 4);
    addWall(session, 3, 4, 0, 4);
    addWall(session, 0, 4, 0, 0);
    const spaces = detectSpaces(session.doc, null);
    expect(spaces.length).toBe(1);
    expect(spaces[0].grossArea).toBeCloseTo(18, 6);
    expect(spaces[0].netArea).toBeCloseTo(15.09, 6); // 21.09 − 3.0×2.0 notch
    expect(pointInLoop(spaces[0].labelPoint, spaces[0].boundary)).toBe(true);
  });

  test('crossing partitions inside a room yield four quadrants', () => {
    const session = new EditorSession();
    drawRoom(session);
    addWall(session, 0, 2, 6, 2); // tees into left/right walls, crosses…
    addWall(session, 3, 0, 3, 4); // …this one at (3, 2)
    const spaces = detectSpaces(session.doc, null);
    expect(spaces.length).toBe(4);
    for (const space of spaces) {
      expect(space.grossArea).toBeCloseTo(6, 6); // 3 × 2 centerline
      expect(space.netArea).toBeCloseTo(2.7 * 1.7, 6);
    }
  });

  test('a door opening does not leak the space (baselines stay continuous)', () => {
    const session = new EditorSession();
    drawRoom(session);
    const partition = addWall(session, 2, 0, 2, 4);
    session.dispatch('DOOR.ADD', { wallId: partition, t: 0.5, width: 0.9 });
    expect(detectSpaces(session.doc, null).length).toBe(2);
  });

  test('spaces are detected per level, the way plan views query', () => {
    const session = new EditorSession();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', {
      name: 'L1',
      elevation: 0,
    });
    const l2 = session.dispatch<LevelId>('LEVEL.ADD', {
      name: 'L2',
      elevation: 3,
    });
    drawRoom(session, l1);
    expect(detectSpaces(session.doc, l1).length).toBe(1);
    expect(detectSpaces(session.doc, l2).length).toBe(0);
    // level-unassigned walls bound rooms on every level
    const unassigned = new EditorSession();
    drawRoom(unassigned);
    const ul1 = unassigned.dispatch<LevelId>('LEVEL.ADD', {
      name: 'L1',
      elevation: 0,
    });
    expect(detectSpaces(unassigned.doc, ul1).length).toBe(1);
  });

  test('digest carries spaces so agents can address rooms', () => {
    const session = new EditorSession();
    drawRoom(session);
    addWall(session, 2, 0, 2, 4);
    const digest = describeDocument(session.doc);
    const spaces = digest['spaces'] as JsonObject[];
    expect(spaces.length).toBe(2);
    for (const space of spaces) {
      expect(typeof space['key']).toBe('string');
      expect(space['netArea'] as number).toBeGreaterThan(0);
      expect((space['walls'] as string[]).length).toBeGreaterThanOrEqual(3);
    }
  });
});
