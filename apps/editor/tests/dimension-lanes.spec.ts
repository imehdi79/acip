import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import {
  layOutDimensions,
  planDimensions,
  wallExtent,
} from '@/editor/viewport/wall-dimensions';
import { withResolvedWalls } from '@/editor/walls';

/**
 * Dimension layout: every wall segment gets its own dimension, and two of them
 * never land on the same line. Lanes are assigned from the measured segments,
 * so the layout follows the geometry rather than any bounding box.
 */

let session: EditorSession;
const PLAN: ViewDefinition = { kind: 'plan', levelId: null };

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const room = (x0: number, y0: number, x1: number, y1: number) => {
  const corners = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return corners.map((a, i) => addWall(a, corners[(i + 1) % corners.length]));
};

const dims = () => planDimensions(session.doc, PLAN);
const laneOf = (id: EntityId) => dims().find((d) => d.entityId === id)?.lane;

/** a bare dimension for the layout function, without a document */
const bare = (id: string, a: Point, b: Point) => ({
  entityId: id as EntityId,
  kind: 'wall' as const,
  a,
  b,
  length: Math.hypot(b.x - a.x, b.y - a.y),
});

beforeEach(() => {
  session = new EditorSession();
});

describe('layOutDimensions', () => {
  it('leaves a lone wall in the first lane', () => {
    const out = layOutDimensions(
      [bare('w', point(0, 0), point(4, 0))],
      point(2, 0),
    );
    expect(out).toHaveLength(1);
    expect(out[0].lane).toBe(0);
  });

  it('puts two collinear overlapping walls in different lanes', () => {
    // the screenshot's middle band: two walls along the same line
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(6, 0)),
        bare('b', point(0, 0), point(4, 0)),
      ],
      point(3, -3),
    );
    expect(out.map((d) => d.lane).sort()).toEqual([0, 1]);
  });

  it('keeps collinear walls that do NOT overlap in the same lane', () => {
    // end to end along one line: no collision, so no wasted lane
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(4, 0)),
        bare('b', point(5, 0), point(9, 0)),
      ],
      point(4, -3),
    );
    expect(out.map((d) => d.lane)).toEqual([0, 0]);
  });

  it('keeps far-apart parallel walls in the same lane', () => {
    // parallel and overlapping, but metres apart and facing opposite ways —
    // each keeps its own side. Different spans, so neither is a duplicate.
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(6, 0)),
        bare('b', point(0, 4), point(5, 4)),
      ],
      point(3, 2),
    );
    expect(out.map((d) => d.lane)).toEqual([0, 0]);
  });

  it('does not let a perpendicular wall push a lane', () => {
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(6, 0)),
        bare('b', point(0, 0), point(0, 4)),
      ],
      point(3, 2),
    );
    expect(out.map((d) => d.lane)).toEqual([0, 0]);
  });

  it('stacks three walls on one line into three lanes', () => {
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(9, 0)),
        bare('b', point(0, 0), point(6, 0)),
        bare('c', point(0, 0), point(3, 0)),
      ],
      point(4, -4),
    );
    expect(out.map((d) => d.lane).sort()).toEqual([0, 1, 2]);
  });

  it('is deterministic — the same input lays out the same way', () => {
    const input = [
      bare('a', point(0, 0), point(6, 0)),
      bare('b', point(0, 0), point(4, 0)),
      bare('c', point(0, 0), point(2, 0)),
    ];
    const first = layOutDimensions(input, point(3, -3));
    const again = layOutDimensions(input, point(3, -3));
    expect(again).toEqual(first);
  });

  it('does not depend on the order the walls arrive in', () => {
    const a = bare('a', point(0, 0), point(6, 0));
    const b = bare('b', point(0, 0), point(4, 0));
    const forward = layOutDimensions([a, b], point(3, -3));
    const backward = layOutDimensions([b, a], point(3, -3));
    expect(backward).toEqual(forward);
  });

  it('gives every dimension a unit side vector', () => {
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(6, 0)),
        bare('b', point(0, 0), point(0, 4)),
      ],
      point(3, 2),
    );
    for (const dim of out) {
      expect(Math.hypot(dim.side.x, dim.side.y)).toBeCloseTo(1, 9);
    }
  });

  it('stands off away from the middle of the plan', () => {
    const out = layOutDimensions(
      [bare('a', point(0, 0), point(6, 0))],
      point(3, 5),
    );
    // the plan's middle is above the wall, so the dimension goes below
    expect(out[0].side.y).toBeLessThan(0);
  });
});

describe('planDimensions over a real document', () => {
  it('measures each distinct span once', () => {
    const ids = room(0, 0, 6, 4);
    // opposite edges of a rectangle measure the same thing, so two will do
    const shown = dims().map((d) => d.entityId);
    expect(shown).toHaveLength(2);
    for (const id of shown) expect(ids).toContain(id);
    expect(
      dims()
        .map((d) => Math.round(d.length * 100) / 100)
        .sort(),
    ).toEqual([4.3, 6.3]);
  });

  it('gives a clean room its dimensions in the first lane', () => {
    room(0, 0, 6, 4);
    expect(dims().every((d) => d.lane === 0)).toBe(true);
  });

  it('follows the split segments after a wall is resolved', () => {
    const host = addWall(point(0, 0), point(6, 0));
    withResolvedWalls(session, () => addWall(point(3, 0), point(3, 4)));

    const after = dims();
    // the host became two segments, so it carries two dimensions, each
    // measuring its own piece rather than the old whole
    const hostWall = session.doc.get(host) as WallEntity;
    const hostDim = after.find((d) => d.entityId === host)!;
    expect(hostDim.length).toBeLessThan(6);
    // collinear pieces butt flush at the tee, so the extent is the centreline
    expect(hostDim.length).toBeCloseTo(hostWall.getLength(), 6);
    expect(after.filter((d) => Math.abs(d.length - 3) < 0.01)).toHaveLength(2);
  });

  it('lanes walls that share a line but measure different spans', () => {
    // two walls along one line covering different stretches: neither is a
    // duplicate, so both are worth showing and they need separate lanes
    addWall(point(0, 4), point(6, 4));
    addWall(point(0, 4), point(9, 4));

    const onTheLine = dims();
    expect(onTheLine).toHaveLength(2);
    expect(onTheLine.map((d) => d.lane).sort()).toEqual([0, 1]);
  });

  it('recomputes when a wall moves', () => {
    const ids = room(0, 0, 6, 4);
    const before = laneOf(ids[0]);

    // drag the bottom wall onto the top wall's line — now they collide
    session.dispatch('GRIP.MOVEMANY', {
      moves: [
        { id: ids[0], index: 0, to: point(0, 4) },
        { id: ids[0], index: 1, to: point(6, 4) },
      ],
    });

    expect(before).toBe(0);
    // both walls now measure the same span on the same line: one is enough
    const after = dims().filter(
      (d) => Math.abs(d.a.y - 4) < 0.2 && Math.abs(d.b.y - 4) < 0.2,
    );
    expect(after).toHaveLength(1);
  });

  it('drops the dimension when its wall is erased', () => {
    const ids = room(0, 0, 6, 4);
    session.dispatch('ENTITY.ERASE', { ids: [ids[0]] });
    expect(dims().map((d) => d.entityId)).not.toContain(ids[0]);
    // the remaining top wall, plus one of the two equal sides
    expect(dims()).toHaveLength(2);
  });

  it('returns nothing for the 3D view', () => {
    room(0, 0, 6, 4);
    expect(planDimensions(session.doc, { kind: '3d' })).toEqual([]);
  });

  it('returns nothing for the 3D view', () => {
    room(0, 0, 6, 4);
    expect(planDimensions(session.doc, { kind: '3d' })).toEqual([]);
  });
});

describe('duplicate spans', () => {
  it('keeps one dimension when two walls measure the same span', () => {
    // opposite sides of a band: same x range, same length, different y
    addWall(point(0, 0), point(6, 0));
    addWall(point(0, 4), point(6, 4));
    expect(dims()).toHaveLength(1);
  });

  it('sees past the caps: same wall positions, one dimension', () => {
    // A room hung under a band. Its top wall is a piece of that band, capped
    // square where the band runs through and stopping short at the tee; its
    // bottom wall miters at both corners. Same 0..4.5 span, DRAWN extents 4.65
    // and 4.80 — the very pair that showed up on one room in the plan.
    // Reading placement off the baseline is what collapses them.
    addWall(point(0, 0), point(8, 0));
    addWall(point(0, -4), point(4.5, -4));
    addWall(point(4.5, -4), point(4.5, 0));
    addWall(point(0, 0), point(0, -4));
    session.dispatch('WALL.RESOLVE', {});

    const walls = session.doc
      .all()
      .filter((e): e is WallEntity => e instanceof WallEntity);
    const span = (w: WallEntity) => {
      const { a, b } = w.getBaseline();
      return `${Math.min(a.x, b.x)}..${Math.max(a.x, b.x)}@${a.y}`;
    };
    // the two walls really are capped differently — that is the trap
    const extents = walls
      .filter((w) => span(w) === '0..4.5@0' || span(w) === '0..4.5@-4')
      .map((w) => Math.round(wallExtent(w)!.length * 100) / 100)
      .sort();
    expect(extents).toEqual([4.65, 4.8]);

    // and yet only one dimension covers that stretch of x
    const onX = dims().filter(
      (d) => Math.abs(d.a.x - 0) < 0.35 && Math.abs(d.length - 4.5) < 0.4,
    );
    expect(onX).toHaveLength(1);
  });

  it('keeps both when the spans differ, even slightly', () => {
    addWall(point(0, 0), point(6, 0));
    addWall(point(0, 4), point(5.9, 4));
    expect(dims()).toHaveLength(2);
  });

  it('keeps both when equal walls sit at different places along the axis', () => {
    // stacked bands: same length, but each measures its own stretch
    addWall(point(0, 0), point(0, 5));
    addWall(point(0, 5), point(0, 10));
    expect(dims()).toHaveLength(2);
  });

  it('does not confuse a horizontal and a vertical of the same length', () => {
    addWall(point(0, 0), point(4, 0));
    addWall(point(0, 0), point(0, 4));
    expect(dims()).toHaveLength(2);
  });

  it('is the selected wall that survives a de-duplication', () => {
    const lower = addWall(point(0, 0), point(6, 0));
    const upper = addWall(point(0, 4), point(6, 4));

    // with nothing selected the first one wins, stably
    expect(dims()[0].entityId).toBe(lower);

    // selecting the other one hands it the dimension, so the highlight has
    // something to land on
    const picked = planDimensions(session.doc, PLAN, new Set([upper]));
    expect(picked).toHaveLength(1);
    expect(picked[0].entityId).toBe(upper);
    expect(picked[0].selected).toBe(true);
  });
});

describe('selection', () => {
  it('marks only the selected wall dimension', () => {
    const ids = room(0, 0, 6, 4);
    const marked = planDimensions(session.doc, PLAN, new Set([ids[0]]));
    expect(marked.filter((d) => d.selected).map((d) => d.entityId)).toEqual([
      ids[0],
    ]);
  });

  it('marks nothing when nothing is selected', () => {
    room(0, 0, 6, 4);
    expect(dims().every((d) => d.selected === false)).toBe(true);
  });

  it('marks every selected wall of a multi-wall selection', () => {
    const ids = room(0, 0, 6, 4);
    const marked = planDimensions(session.doc, PLAN, new Set(ids));
    expect(marked.every((d) => d.selected)).toBe(true);
  });
});
