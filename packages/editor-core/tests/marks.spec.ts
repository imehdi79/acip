import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  describeDocument,
  loadDocument,
  point,
  saveDocument,
} from '../src/index.js';
import type { EntityId, JsonObject, LevelId } from '../src/index.js';

function addWall(
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
    height: 3,
  });
}

describe('entity marks', () => {
  test('creates assign sequential per-type marks', () => {
    const session = new EditorSession();
    const w1 = addWall(session, 0, 0, 6, 0);
    const w2 = addWall(session, 6, 0, 6, 4);
    const d1 = session.dispatch<EntityId>('DOOR.ADD', {
      wallId: w1,
      t: 0.5,
      width: 0.9,
      height: 2.1,
    });
    expect(session.doc.get(w1)?.mark).toBe(1);
    expect(session.doc.get(w2)?.mark).toBe(2);
    // each type numbers independently
    expect(session.doc.get(d1)?.mark).toBe(1);
  });

  test('byMark resolves the "wall 3" lookup', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 6, 0);
    const w2 = addWall(session, 6, 0, 6, 4);
    expect(session.doc.byMark('wall', 2)?.id).toBe(w2);
    expect(session.doc.byMark('wall', 99)).toBeNull();
  });

  test('erased marks are never reused', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 6, 0);
    const w2 = addWall(session, 6, 0, 6, 4);
    session.dispatch('ENTITY.ERASE', { ids: [w2] });
    const w3 = addWall(session, 0, 4, 6, 4);
    expect(session.doc.get(w3)?.mark).toBe(3);
  });

  test('undone creates retire their number too', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 6, 0);
    session.undo();
    const w = addWall(session, 0, 0, 6, 0);
    expect(session.doc.get(w)?.mark).toBe(2);
  });

  test('undoing an erase restores the original mark', () => {
    const session = new EditorSession();
    const w1 = addWall(session, 0, 0, 6, 0);
    session.dispatch('ENTITY.ERASE', { ids: [w1] });
    session.undo();
    expect(session.doc.get(w1)?.mark).toBe(1);
    // and the counter did not fall behind: next wall is 2
    const w2 = addWall(session, 6, 0, 6, 4);
    expect(session.doc.get(w2)?.mark).toBe(2);
  });

  test('marks survive save/open and numbering continues past them', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 6, 0);
    const w2 = addWall(session, 6, 0, 6, 4);
    const data = saveDocument(session.doc);

    const reopened = new EditorSession();
    reopened.open(data);
    expect(reopened.doc.get(w2)?.mark).toBe(2);
    const w3 = addWall(reopened, 0, 4, 6, 4);
    expect(reopened.doc.get(w3)?.mark).toBe(3);

    // loadDocument path (fresh doc) derives the counter the same way
    const doc2 = loadDocument(data, session.entityTypes);
    expect(doc2.get(w2)?.mark).toBe(2);
  });

  test('level duplication gives the copies fresh marks', () => {
    const session = new EditorSession();
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', {
      name: 'L1',
      elevation: 0,
    });
    session.dispatch('WALL.ADD', {
      a: point(0, 0),
      b: point(6, 0),
      thickness: 0.3,
      height: 3,
      levelId: l1,
    });
    session.dispatch('LEVEL.DUPLICATE', {
      sourceLevelId: l1,
      name: 'L2',
      elevation: 3,
    });
    const marks = session.doc
      .all()
      .filter((e) => e.type === 'wall')
      .map((e) => e.mark)
      .sort();
    expect(marks).toEqual([1, 2]);
  });

  test('the LLM digest carries marks on entities and spaces', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 6, 0);
    addWall(session, 6, 0, 6, 4);
    addWall(session, 6, 4, 0, 4);
    addWall(session, 0, 4, 0, 0);
    const digest = describeDocument(session.doc);
    const entities = digest['entities'] as JsonObject[];
    expect(entities.map((e) => e['mark']).sort()).toEqual([1, 2, 3, 4]);
    const spaces = digest['spaces'] as JsonObject[];
    expect(spaces.length).toBe(1);
    expect([...(spaces[0]['wallMarks'] as number[])].sort()).toEqual([
      1, 2, 3, 4,
    ]);
  });
});
