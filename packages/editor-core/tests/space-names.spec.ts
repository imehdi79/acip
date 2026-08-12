import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  SpaceTagEntity,
  ValidationError,
  detectSpaces,
  isEntityVisible,
  point,
  spaceName,
} from '../src/index.js';
import type { EntityId, LayerId, Point } from '../src/index.js';

/** closed loop of walls through the given corners */
function room(session: EditorSession, corners: Point[]): EntityId[] {
  return corners.map((a, i) =>
    session.dispatch<EntityId>('WALL.ADD', {
      a,
      b: corners[(i + 1) % corners.length],
      thickness: 0.2,
    }),
  );
}

const square = (x = 0, y = 0, size = 4): Point[] => [
  point(x, y),
  point(x + size, y),
  point(x + size, y + size),
  point(x, y + size),
];

const nameOfOnlySpace = (session: EditorSession): string | null =>
  spaceName(session.doc, detectSpaces(session.doc, null)[0]);

describe('SPACE.SETNAME', () => {
  test('names the room containing the point', () => {
    const session = new EditorSession();
    room(session, square());

    const tagId = session.dispatch<EntityId | null>('SPACE.SETNAME', {
      at: point(2, 2),
      name: 'Kitchen',
    });

    expect(tagId).not.toBeNull();
    expect(session.doc.get(tagId as EntityId)).toBeInstanceOf(SpaceTagEntity);
    expect(nameOfOnlySpace(session)).toBe('Kitchen');
  });

  test('renaming reuses the tag instead of stacking a second one', () => {
    const session = new EditorSession();
    room(session, square());

    const first = session.dispatch<EntityId | null>('SPACE.SETNAME', {
      at: point(2, 2),
      name: 'Kitchen',
    });
    const second = session.dispatch<EntityId | null>('SPACE.SETNAME', {
      at: point(1, 1),
      name: 'Utility',
    });

    expect(second).toBe(first);
    expect(nameOfOnlySpace(session)).toBe('Utility');
    expect(
      session.doc.all().filter((e) => e instanceof SpaceTagEntity),
    ).toHaveLength(1);
  });

  test('an empty name clears it and removes the tag', () => {
    const session = new EditorSession();
    room(session, square());
    session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Kitchen' });

    const cleared = session.dispatch<EntityId | null>('SPACE.SETNAME', {
      at: point(2, 2),
      name: '   ',
    });

    expect(cleared).toBeNull();
    expect(nameOfOnlySpace(session)).toBeNull();
    expect(
      session.doc.all().filter((e) => e instanceof SpaceTagEntity),
    ).toHaveLength(0);
  });

  test('names are per room, not per drawing', () => {
    const session = new EditorSession();
    room(session, square(0, 0, 4));
    room(session, square(10, 0, 4));

    session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Kitchen' });
    session.dispatch('SPACE.SETNAME', { at: point(12, 2), name: 'Bath' });

    const named = detectSpaces(session.doc, null).map((space) =>
      spaceName(session.doc, space),
    );
    expect(named.slice().sort()).toEqual(['Bath', 'Kitchen']);
  });

  test('the name survives a wall move that keeps the tag inside', () => {
    const session = new EditorSession();
    const walls = room(session, square(0, 0, 4));
    session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Kitchen' });

    // stretch the far wall outward — same room, bigger
    session.dispatch('GRIP.MOVEMANY', {
      moves: [
        { id: walls[1], index: 1, to: point(6, 4) },
        { id: walls[2], index: 0, to: point(6, 4) },
        { id: walls[1], index: 0, to: point(6, 0) },
        { id: walls[0], index: 1, to: point(6, 0) },
      ],
    });

    const spaces = detectSpaces(session.doc, null);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].netArea).toBeGreaterThan(15);
    expect(spaceName(session.doc, spaces[0])).toBe('Kitchen');
  });

  test('refuses a point that is in no room', () => {
    const session = new EditorSession();
    room(session, square());
    expect(() =>
      session.dispatch('SPACE.SETNAME', { at: point(50, 50), name: 'Nowhere' }),
    ).toThrow(ValidationError);
  });

  test('undo takes the name back off', () => {
    const session = new EditorSession();
    room(session, square());
    session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Kitchen' });

    session.undo();

    expect(nameOfOnlySpace(session)).toBeNull();
    session.redo();
    expect(nameOfOnlySpace(session)).toBe('Kitchen');
  });

  test('the tag round-trips through save and open', () => {
    const session = new EditorSession();
    room(session, square());
    session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Kitchen' });

    const saved = session.save();
    const reopened = new EditorSession();
    reopened.open(saved);

    expect(nameOfOnlySpace(reopened)).toBe('Kitchen');
  });

  test('the name lands on the given layer, and hides with it', () => {
    // a name is drawing, not a property of the model: written onto a layer
    // that is later switched off it goes with it, which is what makes a room
    // renameable as part of a marked-up change instead of over the survey
    const session = new EditorSession();
    room(session, square());
    const markup = session.dispatch<LayerId>('LAYER.ADD', { name: 'markup' });
    const tagId = session.dispatch<EntityId | null>('SPACE.SETNAME', {
      at: point(2, 2),
      name: 'Kitchen',
      layerId: markup,
    });
    const tag = session.doc.get(tagId as EntityId) as SpaceTagEntity;
    expect(tag.layerId).toBe(markup);

    session.dispatch('LAYER.UPDATE', { id: markup, visible: false });
    // the model still knows the name; what a VIEW does with a hidden tag is
    // the view's business (see isEntityVisible)
    expect(nameOfOnlySpace(session)).toBe('Kitchen');
    expect(isEntityVisible(session.doc, tag)).toBe(false);
  });

  test('a name on a locked layer is not renamed or removed', () => {
    // the lock is the whole of "this drawing is not yours to edit", and the
    // name is part of the drawing — this was the one path left that could
    // rewrite a plan every other path refuses to touch
    const session = new EditorSession();
    room(session, square());
    const survey = session.dispatch<LayerId>('LAYER.ADD', { name: 'survey' });
    session.dispatch('SPACE.SETNAME', {
      at: point(2, 2),
      name: 'Kitchen',
      layerId: survey,
    });
    session.dispatch('LAYER.UPDATE', { id: survey, locked: true });

    expect(() =>
      session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Bathroom' }),
    ).toThrow(ValidationError);
    // and clearing it is a change too
    expect(() =>
      session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: '' }),
    ).toThrow(ValidationError);
    expect(nameOfOnlySpace(session)).toBe('Kitchen');

    session.dispatch('LAYER.UPDATE', { id: survey, locked: false });
    session.dispatch('SPACE.SETNAME', { at: point(2, 2), name: 'Bathroom' });
    expect(nameOfOnlySpace(session)).toBe('Bathroom');
  });

  test('the tag is not pickable — a tap in the room still finds the room', () => {
    const session = new EditorSession();
    room(session, square());
    const tagId = session.dispatch<EntityId | null>('SPACE.SETNAME', {
      at: point(2, 2),
      name: 'Kitchen',
    });
    const tag = session.doc.get(tagId as EntityId) as SpaceTagEntity;
    expect(tag.hitTest()).toBe(false);
  });
});
