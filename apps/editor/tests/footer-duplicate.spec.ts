import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  bboxIntersects,
  point,
} from '@acip/editor-core';
import type { BBox, EntityId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import {
  duplicateSelection,
  planDuplicateOffset,
} from '@/app/components/layout/footer/duplicate';

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

const boundsOf = (id: EntityId): BBox => session.doc.get(id)!.getBounds();

const shift = (b: BBox, by: Point): BBox => ({
  minX: b.minX + by.x,
  minY: b.minY + by.y,
  maxX: b.maxX + by.x,
  maxY: b.maxY + by.y,
});

/** does this entity keep out of everything else on the plan? */
const standsAlone = (id: EntityId): boolean =>
  session.doc
    .all()
    .filter((e) => e.id !== id)
    .every((e) => !bboxIntersects(boundsOf(id), e.getBounds()));

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

  it('lands clear when the spot on the right is taken', () => {
    const id = addWall(0, 0, 4, 0);
    const seed = boundsOf(id);
    // exactly where the old fixed shift would have dropped the copy
    addWall(5, 0, 9, 0);
    session.selection.add(id);

    duplicateSelection(session, runtime.ui);

    const copy = walls().find(
      (wall) => wall.id !== id && wall.getBaseline().a.x < 1,
    )!;
    expect(standsAlone(copy.id)).toBe(true);
    // next in the order is below, one bbox height plus the gap down
    expect(copy.getBaseline().a.y).toBeCloseTo(-(seed.maxY - seed.minY + 1));
  });

  it('frames the copy wherever it went', () => {
    const id = addWall(0, 0, 4, 0);
    addWall(5, 0, 9, 0);
    session.selection.add(id);

    duplicateSelection(session, runtime.ui);

    const fit = runtime.ui.fitTarget.get()!;
    const copy = walls().find(
      (wall) => wall.id !== id && wall.getBaseline().a.x < 1,
    )!;
    const copyBounds = copy.getBounds();
    expect(fit.minY).toBeLessThanOrEqual(copyBounds.minY);
    expect(fit.maxY).toBeGreaterThanOrEqual(copyBounds.maxY);
  });

  it('keeps the plain right shift on an empty plan', () => {
    const id = addWall(0, 0, 4, 0);
    expect(planDuplicateOffset(session.doc, [id])).toMatchObject({
      x: 5,
      y: 0,
    });
  });

  it('survives an empty plan with nothing selected', () => {
    expect(() => duplicateSelection(session, runtime.ui)).not.toThrow();
    expect(planDuplicateOffset(session.doc, [])).toMatchObject({ x: 0, y: 0 });
    expect(session.doc.count).toBe(0);
  });

  it('picks the same spot every time for the same drawing', () => {
    const plan = (): EntityId => {
      const id = addWall(0, 0, 4, 0);
      addWall(5, 0, 9, 0);
      addWall(0, -1.5, 4, -1.5);
      addWall(-5, 0, -1, 0);
      return id;
    };

    const id = plan();
    const first = planDuplicateOffset(session.doc, [id]);
    expect(planDuplicateOffset(session.doc, [id])).toEqual(first);
    expect(planDuplicateOffset(session.doc, [id])).toEqual(first);

    // and the same again from a drawing built from scratch — the answer comes
    // from the geometry, not from entity ids or insertion luck
    session = new EditorSession();
    runtime = createRuntime(session);
    const again = plan();
    expect(planDuplicateOffset(session.doc, [again])).toEqual(first);
  });

  it('falls back to the right shift when every slot is taken', () => {
    const id = addWall(0, 0, 4, 0);
    const seed = boundsOf(id);
    const stepX = seed.maxX - seed.minX + 1;
    const stepY = seed.maxY - seed.minY + 1;
    const cx = (seed.minX + seed.maxX) / 2;
    const cy = (seed.minY + seed.maxY) / 2;

    // a stub in the middle of every slot the search will look at, far enough
    // out that the search has to give up rather than wander forever
    for (let ring = 1; ring <= 12; ring++) {
      for (const dir of [
        point(1, 0),
        point(0, -1),
        point(-1, 0),
        point(0, 1),
      ]) {
        const x = cx + dir.x * stepX * ring;
        const y = cy + dir.y * stepY * ring;
        addWall(x - 0.25, y, x + 0.25, y);
      }
    }
    session.selection.add(id);

    const offset = planDuplicateOffset(session.doc, [id]);
    expect(offset).toMatchObject({ x: stepX, y: 0 });
    // the fallback knowingly lands on something — that is why the resolve runs
    const taken = session.doc
      .queryBBox(shift(seed, offset))
      .filter((e) => e.id !== id);
    expect(taken.length).toBeGreaterThan(0);
  });
});
