import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  ValidationError,
  WallEntity,
  WindowEntity,
  point,
} from '../src/index.js';
import type { EntityId } from '../src/index.js';

function wall(
  session: EditorSession,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): EntityId {
  return session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 2.7,
  });
}

const baseline = (session: EditorSession, id: EntityId) =>
  (session.doc.get(id) as WallEntity).getBaseline();

describe('ENTITY.DUPLICATE', () => {
  test('copies a wall offset by delta, leaving the original alone', () => {
    const session = new EditorSession();
    const source = wall(session, 0, 0, 4, 0);

    const copies = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
      ids: [source],
      delta: point(0, 5),
    });

    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toBe(source);
    expect(baseline(session, source).a).toEqual(point(0, 0));
    expect(baseline(session, copies[0]).a).toEqual(point(0, 5));
    expect(baseline(session, copies[0]).b).toEqual(point(4, 5));
  });

  test('carries the wall properties, but not its mark', () => {
    const session = new EditorSession();
    const source = wall(session, 0, 0, 4, 0);
    const [copyId] = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
      ids: [source],
      delta: point(0, 5),
    });

    const original = session.doc.get(source) as WallEntity;
    const copy = session.doc.get(copyId) as WallEntity;
    expect(copy.getThickness()).toBe(original.getThickness());
    expect(copy.getHeight()).toBe(original.getHeight());
    // marks are handles users and agents quote — a copy is a new thing
    expect(copy.mark).not.toBe(original.mark);
  });

  test('a copied wall carries its windows, attached to the copy', () => {
    const session = new EditorSession();
    const source = wall(session, 0, 0, 4, 0);
    session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: source,
      t: 0.5,
      width: 1,
    });

    const [copyId] = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
      ids: [source],
      delta: point(0, 5),
    });

    const hosted = session.doc.relations.dependentsOf(copyId);
    expect(hosted).toHaveLength(1);
    const window = session.doc.get(hosted[0]) as WindowEntity;
    expect(window).toBeInstanceOf(WindowEntity);
    expect(window.t).toBe(0.5);
    // and the original still has exactly its own
    expect(session.doc.relations.dependentsOf(source)).toHaveLength(1);
  });

  test('a window listed next to its own wall is not copied twice', () => {
    const session = new EditorSession();
    const source = wall(session, 0, 0, 4, 0);
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: source,
      t: 0.5,
      width: 1,
    });

    const copies = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
      ids: [source, window],
      delta: point(0, 5),
    });

    expect(copies).toHaveLength(1);
    expect(session.doc.relations.dependentsOf(copies[0])).toHaveLength(1);
  });

  test('duplicating a whole room is one undo', () => {
    const session = new EditorSession();
    const corners = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    const walls = corners.map((a, i) =>
      session.dispatch<EntityId>('WALL.ADD', {
        a,
        b: corners[(i + 1) % corners.length],
      }),
    );
    const before = session.doc.all().length;

    const copies = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
      ids: walls,
      delta: point(6, 0),
    });
    expect(copies).toHaveLength(4);
    expect(session.doc.all()).toHaveLength(before + 4);

    session.undo();
    expect(session.doc.all()).toHaveLength(before);
  });

  test('omitting delta stacks the copy on the original', () => {
    const session = new EditorSession();
    const source = wall(session, 0, 0, 4, 0);
    const [copyId] = session.dispatch<EntityId[]>('ENTITY.DUPLICATE', {
      ids: [source],
    });
    expect(baseline(session, copyId)).toEqual(baseline(session, source));
  });

  test('rejects unknown ids rather than silently copying nothing', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('ENTITY.DUPLICATE', { ids: ['nope'] }),
    ).toThrow(ValidationError);
  });
});
