import { describe, expect, it } from 'vitest';
import { EditorSession, buildDisplayList, point } from '@acip/editor-core';
import type { EntityId, MaterialId } from '@acip/editor-core';
import { inPaintOrder } from '@/editor/viewport/scene-renderer';

/**
 * A finish is created long after the wall it sits on and the openings cut
 * through it, so in document order its dashed band paints straight over the
 * door — hiding the one thing on that wall a reader navigates by, and hiding
 * it only on the walls that had been priced.
 */
describe('what the plan paints last', () => {
  /** a wall with a window and a door in it, and a finish over the whole face */
  function pricedWall(): {
    session: EditorSession;
    ids: Record<string, string>;
  } {
    const session = new EditorSession();
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(6, 0),
      thickness: 0.3,
      height: 3,
    });
    const windowId = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId,
      t: 0.3,
    });
    const doorId = session.dispatch<EntityId>('DOOR.ADD', {
      wallId,
      t: 0.7,
      width: 0.9,
    });
    const paint = session.dispatch<MaterialId>('MATERIAL.ADD', {
      name: 'Paint',
      unit: 'm2',
      costCode: 'paint',
    });
    // last, exactly as the estimator writes it
    const finishId = session.dispatch<EntityId>('FINISH.ADD', {
      wallId,
      side: 'face+',
      materialId: paint,
    });
    return {
      session,
      ids: { wallId, windowId, doorId, finishId },
    };
  }

  const view = { kind: 'plan', levelId: null } as const;

  it('is the bug: document order puts the finish over the openings', () => {
    // the state this exists to correct — kept as a test so the fix cannot be
    // quietly undone by someone "simplifying" the renderer back
    const { session, ids } = pricedWall();
    const order = buildDisplayList(session.doc, view).map((i) => i.entityId);
    expect(order.indexOf(ids.finishId)).toBeGreaterThan(
      order.indexOf(ids.doorId),
    );
  });

  it('paints the door and the window after the finish', () => {
    const { session, ids } = pricedWall();
    const order = inPaintOrder(session.doc, view).map((i) => i.entityId);
    const finish = order.indexOf(ids.finishId);
    expect(order.indexOf(ids.doorId)).toBeGreaterThan(finish);
    expect(order.indexOf(ids.windowId)).toBeGreaterThan(finish);
  });

  it('loses nothing on the way', () => {
    // a partition, not a filter: every item still gets drawn
    const { session } = pricedWall();
    const before = buildDisplayList(session.doc, view).map((i) => i.entityId);
    const after = inPaintOrder(session.doc, view).map((i) => i.entityId);
    expect([...after].sort()).toEqual([...before].sort());
  });

  it('leaves everything that is not an opening in the order it had', () => {
    // a STABLE partition: only the openings move, so this cannot reshuffle
    // anything else that paints over its neighbour today
    const { session } = pricedWall();
    const openings = new Set(
      inPaintOrder(session.doc, view)
        .slice(-2)
        .map((i) => i.entityId),
    );
    const before = buildDisplayList(session.doc, view)
      .map((i) => i.entityId)
      .filter((id) => !openings.has(id));
    const after = inPaintOrder(session.doc, view)
      .map((i) => i.entityId)
      .filter((id) => !openings.has(id));
    expect(after).toEqual(before);
  });
});
