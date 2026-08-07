import { describe, expect, test } from 'bun:test';
import { EditorSession, classifySelection, point } from '../src/index.js';
import type { EntityId, Point } from '../src/index.js';

/** closed loop of walls through the given corners */
function room(session: EditorSession, corners: Point[]): EntityId[] {
  return corners.map((a, i) =>
    session.dispatch<EntityId>('WALL.ADD', {
      a,
      b: corners[(i + 1) % corners.length],
    }),
  );
}

const square = (x = 0, y = 0, size = 4): Point[] => [
  point(x, y),
  point(x + size, y),
  point(x + size, y + size),
  point(x, y + size),
];

describe('classifySelection', () => {
  test('empty selection is none', () => {
    const session = new EditorSession();
    const info = classifySelection(session.doc, []);
    expect(info.kind).toBe('none');
    expect(info.count).toBe(0);
    expect(info.types).toEqual([]);
    expect(info.space).toBeNull();
  });

  test('one wall classifies as its own entity type', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(4, 0),
    });
    const info = classifySelection(session.doc, [id]);
    expect(info.kind).toBe('wall');
    expect(info.types).toEqual(['wall']);
    expect(info.space).toBeNull();
  });

  test('a wall plus a hosted window is mixed', () => {
    const session = new EditorSession();
    const wall = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(4, 0),
    });
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: wall,
      t: 0.5,
      width: 1,
    });
    const info = classifySelection(session.doc, [wall, window]);
    expect(info.kind).toBe('mixed');
    expect(info.types).toEqual(['wall', 'window']);
  });

  test('the four walls of a closed room classify as room', () => {
    const session = new EditorSession();
    const ids = room(session, square());
    const info = classifySelection(session.doc, ids);
    expect(info.kind).toBe('room');
    expect(info.count).toBe(4);
    expect(info.space).not.toBeNull();
    expect(info.space?.boundaryWallIds.length).toBe(4);
  });

  test('three of those four walls are just walls, not a room', () => {
    const session = new EditorSession();
    const ids = room(session, square());
    const info = classifySelection(session.doc, ids.slice(0, 3));
    expect(info.kind).toBe('wall');
    expect(info.space).toBeNull();
  });

  test('an L-shaped room classifies as room too, not only rectangles', () => {
    const session = new EditorSession();
    const ids = room(session, [
      point(0, 0),
      point(6, 0),
      point(6, 3),
      point(3, 3),
      point(3, 5),
      point(0, 5),
    ]);
    const info = classifySelection(session.doc, ids);
    expect(info.kind).toBe('room');
    expect(info.count).toBe(6);
  });

  test('ids that no longer resolve are ignored', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(4, 0),
    });
    const info = classifySelection(session.doc, [id, 'gone' as EntityId]);
    expect(info.count).toBe(1);
    expect(info.kind).toBe('wall');
  });
});
