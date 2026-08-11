import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import {
  layOutDimensions,
  wallDimensions,
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

const dims = () => wallDimensions(session.doc, PLAN);
const laneOf = (id: EntityId) => dims().find((d) => d.wallId === id)?.lane;

/** a bare dimension for the layout function, without a document */
const bare = (id: string, a: Point, b: Point) => ({
  wallId: id as EntityId,
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
    // the two long sides of a room: parallel, overlapping spans, but metres
    // apart and facing opposite ways — each keeps its own side
    const out = layOutDimensions(
      [
        bare('a', point(0, 0), point(6, 0)),
        bare('b', point(0, 4), point(6, 4)),
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

describe('wallDimensions over a real document', () => {
  it('measures one dimension per wall segment', () => {
    const ids = room(0, 0, 6, 4);
    expect(
      dims()
        .map((d) => d.wallId)
        .sort(),
    ).toEqual([...ids].sort());
  });

  it('gives a clean room four dimensions in the first lane', () => {
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
    const hostDim = after.find((d) => d.wallId === host)!;
    expect(hostDim.length).toBeLessThan(6);
    // collinear pieces butt flush at the tee, so the extent is the centreline
    expect(hostDim.length).toBeCloseTo(hostWall.getLength(), 6);
    expect(after.filter((d) => Math.abs(d.length - 3) < 0.01)).toHaveLength(2);
  });

  it('separates two rooms sharing a wall line into lanes', () => {
    // exactly the screenshot: one room above another, their shared band
    // carrying two walls on the same line
    room(0, 4, 6, 8);
    room(0, 0, 6, 4);

    const onTheLine = dims().filter(
      (d) => Math.abs(d.a.y - 4) < 0.2 && Math.abs(d.b.y - 4) < 0.2,
    );
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
    const after = dims().filter(
      (d) => Math.abs(d.a.y - 4) < 0.2 && Math.abs(d.b.y - 4) < 0.2,
    );
    expect(after.map((d) => d.lane).sort()).toEqual([0, 1]);
  });

  it('drops the dimension when its wall is erased', () => {
    const ids = room(0, 0, 6, 4);
    session.dispatch('ENTITY.ERASE', { ids: [ids[0]] });
    expect(dims().map((d) => d.wallId)).not.toContain(ids[0]);
    expect(dims()).toHaveLength(3);
  });

  it('returns nothing for the 3D view', () => {
    room(0, 0, 6, 4);
    expect(wallDimensions(session.doc, { kind: '3d' })).toEqual([]);
  });
});
