import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  classifySelection,
  detectSpaces,
  point,
  spaceName,
} from '@acip/editor-core';
import type { EntityId, ViewDefinition } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';

/**
 * The room-name flow as the app drives it: tap a room (which selects its
 * boundary walls), name it, and the plan renderer finds that name for the
 * space it is about to label.
 */

let session: EditorSession;
let runtime: EditorRuntime;

function selectRoom(width = 6, height = 4): EntityId[] {
  const corners = [
    point(0, 0),
    point(width, 0),
    point(width, height),
    point(0, height),
  ];
  const ids = corners.map((a, i) =>
    session.dispatch<EntityId>('WALL.ADD', {
      a,
      b: corners[(i + 1) % corners.length],
      thickness: 0.3,
    }),
  );
  for (const id of ids) session.selection.add(id);
  return ids;
}

/** exactly what scene-renderer reads when it draws room labels */
function labels(): { name: string | null; area: string }[] {
  const view: ViewDefinition = {
    kind: 'plan',
    levelId: runtime.ui.activeLevelId.get(),
  };
  return detectSpaces(session.doc, view.levelId).map((space) => ({
    name: spaceName(session.doc, space),
    area: `${space.netArea.toFixed(1)} m²`,
  }));
}

/** what the footer's Room name dialog does on Save */
function setName(name: string): void {
  const space = classifySelection(
    session.doc,
    session.selection.list(),
    runtime.ui.activeLevelId.get(),
  ).space;
  if (!space) throw new Error('selection is not a room');
  session.dispatch('SPACE.SETNAME', { at: space.labelPoint, name });
}

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
});

describe('naming a room from the footer', () => {
  it('labels an unnamed room with its area alone', () => {
    selectRoom();
    expect(labels()).toEqual([{ name: null, area: '21.1 m²' }]);
  });

  it('renders the name alongside the area once set', () => {
    selectRoom();
    setName('Kitchen');
    expect(labels()).toEqual([{ name: 'Kitchen', area: '21.1 m²' }]);
  });

  it('keeps the name when the room is resized', () => {
    selectRoom();
    setName('Kitchen');

    session.dispatch('GRIP.MOVEMANY', {
      moves: [
        { id: session.selection.list()[0], index: 1, to: point(8, 0) },
        { id: session.selection.list()[1], index: 0, to: point(8, 0) },
        { id: session.selection.list()[1], index: 1, to: point(8, 4) },
        { id: session.selection.list()[2], index: 0, to: point(8, 4) },
      ],
    });

    expect(labels()[0].name).toBe('Kitchen');
    expect(labels()[0].area).not.toBe('21.1 m²');
  });

  it('clears the name on an empty string', () => {
    selectRoom();
    setName('Kitchen');
    setName('');
    expect(labels()[0].name).toBeNull();
  });

  it('does not make the label selectable', () => {
    selectRoom();
    setName('Kitchen');
    session.selection.clear();

    // the tag sits at the room's label point; a tap there must find nothing
    const at = detectSpaces(session.doc, null)[0].labelPoint;
    const hits = session.doc
      .queryBBox({
        minX: at.x - 0.5,
        minY: at.y - 0.5,
        maxX: at.x + 0.5,
        maxY: at.y + 0.5,
      })
      .filter((entity) => entity.hitTest(at, 0.2));
    expect(hits).toEqual([]);
  });
});
