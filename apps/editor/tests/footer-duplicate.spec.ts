import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { duplicateSelection } from '@/app/components/layout/footer/duplicate';

/**
 * The footer's Duplicate button: core does the copying, this covers the part
 * the app owns — where the copy lands and what stays selected afterwards.
 */

let session: EditorSession;
let runtime: EditorRuntime;

const addWall = (ax: number, ay: number, bx: number, by: number) =>
  session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
  });

const walls = () =>
  session.doc.all().filter((e): e is WallEntity => e instanceof WallEntity);

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
});

describe('duplicateSelection', () => {
  it('does nothing without a selection', () => {
    addWall(0, 0, 4, 0);
    duplicateSelection(session, runtime.ui);
    expect(walls()).toHaveLength(1);
  });

  it('drops the copy clear of the original, to its right', () => {
    const id = addWall(0, 0, 4, 0);
    session.selection.add(id);

    duplicateSelection(session, runtime.ui);

    expect(walls()).toHaveLength(2);
    const copy = walls().find((wall) => wall.id !== id)!;
    // 4 m wide plus the 1 m gap — no overlap with the original
    expect(copy.getBaseline().a.x).toBeCloseTo(5);
    expect(copy.getBaseline().b.x).toBeCloseTo(9);
    expect(copy.getBaseline().a.y).toBeCloseTo(0);
  });

  it('leaves the copy selected, not the original', () => {
    const id = addWall(0, 0, 4, 0);
    session.selection.add(id);

    duplicateSelection(session, runtime.ui);

    const selected = session.selection.list();
    expect(selected).toHaveLength(1);
    expect(selected[0]).not.toBe(id);
  });

  it('duplicates a whole room as one undo', () => {
    const corners = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i];
      const b = corners[(i + 1) % corners.length];
      session.selection.add(addWall(a.x, a.y, b.x, b.y));
    }

    duplicateSelection(session, runtime.ui);
    expect(walls()).toHaveLength(8);

    session.undo();
    expect(walls()).toHaveLength(4);
  });

  it('frames original and copy together', () => {
    const id = addWall(0, 0, 4, 0);
    session.selection.add(id);

    duplicateSelection(session, runtime.ui);

    expect(runtime.ui.fitTarget.get()).toMatchObject({ minX: 0, maxX: 9 });
  });
});
