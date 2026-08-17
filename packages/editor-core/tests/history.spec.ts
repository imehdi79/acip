import { describe, expect, test } from 'bun:test';
import { EditorSession, point } from '../src/index.js';
import type { DocumentChangeEvent, EntityId } from '../src/index.js';

/**
 * History's contract is not only "the stacks end up right" — it is what a
 * change listener SEES while the event is being delivered. The footer greys
 * its Undo/Redo buttons from inside that event and hears nothing from history
 * afterwards, so a canUndo/canRedo that only becomes true once the call has
 * returned is a button the user can never press. Every assertion below is
 * therefore about what the listener observed, not about the state at the end.
 */

interface Observed {
  readonly kind: DocumentChangeEvent['kind'];
  readonly canUndo: boolean;
  readonly canRedo: boolean;
}

/** what a listener sees, from inside each event, in order */
function watch(session: EditorSession): Observed[] {
  const seen: Observed[] = [];
  session.doc.events.on('change', (event) => {
    seen.push({
      kind: event.kind,
      canUndo: session.history.canUndo,
      canRedo: session.history.canRedo,
    });
  });
  return seen;
}

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
  });
}

describe('history events', () => {
  test('a commit event already sees the undo it enabled', () => {
    const session = new EditorSession();
    const seen = watch(session);

    addWall(session, 0, 0, 4, 0);

    expect(seen).toEqual([{ kind: 'commit', canUndo: true, canRedo: false }]);
  });

  test('an undo event already sees the redo it enabled', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 4, 0);
    addWall(session, 4, 0, 4, 4);
    const seen = watch(session);

    session.undo();

    // the wall below it is still there to undo, and the one just undone is
    // there to redo — both, during the event, not a tick later
    expect(seen).toEqual([{ kind: 'undo', canUndo: true, canRedo: true }]);
  });

  test('a redo event already sees the undo it restored', () => {
    const session = new EditorSession();
    addWall(session, 0, 0, 4, 0);
    session.undo();
    const seen = watch(session);

    session.redo();

    expect(seen).toEqual([{ kind: 'redo', canUndo: true, canRedo: false }]);
  });

  test('every event observes the state its operation finished in', () => {
    const session = new EditorSession();
    const seen = watch(session);
    const ends: Observed[] = [];
    const record = (kind: DocumentChangeEvent['kind']) =>
      ends.push({
        kind,
        canUndo: session.history.canUndo,
        canRedo: session.history.canRedo,
      });

    addWall(session, 0, 0, 4, 0);
    record('commit');
    addWall(session, 4, 0, 4, 4);
    record('commit');
    session.undo();
    record('undo');
    session.undo();
    record('undo');
    session.redo();
    record('redo');

    expect(seen).toEqual(ends);
  });

  test('a group moves between the stacks as one', () => {
    const session = new EditorSession();
    session.history.beginGroup();
    addWall(session, 0, 0, 4, 0);
    addWall(session, 4, 0, 4, 4);
    addWall(session, 4, 4, 0, 4);
    session.history.endGroup();
    const seen = watch(session);

    session.undo();

    // three records, one entry: no event may catch the group half-moved, with
    // part of it undone but the whole of it still missing from the redo stack
    const undone = { kind: 'undo', canUndo: false, canRedo: true };
    expect(seen).toEqual([undone, undone, undone]);

    seen.length = 0;
    session.redo();

    const redone = { kind: 'redo', canUndo: true, canRedo: false };
    expect(seen).toEqual([redone, redone, redone]);
  });

  test('a group is one undo, whatever it dispatched', async () => {
    const session = new EditorSession();
    await session.history.runGrouped(async () => {
      addWall(session, 0, 0, 4, 0);
      addWall(session, 4, 0, 4, 4);
    });

    expect(session.doc.count).toBe(2);
    session.undo();
    expect(session.doc.count).toBe(0);
    expect(session.history.canUndo).toBe(false);
    session.redo();
    expect(session.doc.count).toBe(2);
  });

  test('a round trip restores the drawing itself, not just the stacks', () => {
    const session = new EditorSession();
    const id = addWall(session, 0, 0, 4, 0);
    const before = session.doc.get(id)?.saveData();

    session.undo();
    expect(session.doc.count).toBe(0);
    expect(session.history.canUndo).toBe(false);
    expect(session.history.canRedo).toBe(true);

    session.redo();
    expect(session.doc.count).toBe(1);
    expect(session.doc.get(id)?.saveData()).toEqual(before);
    expect(session.history.canUndo).toBe(true);
    expect(session.history.canRedo).toBe(false);
  });

  test('undo and redo at the ends of the stacks change nothing', () => {
    const session = new EditorSession();
    const seen = watch(session);

    expect(session.undo()).toBeNull();
    expect(session.redo()).toBeNull();

    expect(seen).toEqual([]);
    expect(session.doc.count).toBe(0);
  });
});
