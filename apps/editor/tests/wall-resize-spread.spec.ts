import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { planWallResize, resizeWallLength } from '@/editor/rooms';

/**
 * What a length edit does to the REST of the plan.
 *
 * Growing one wall has to move other walls — that is what keeps a room a room.
 * The question is which ones and how, and the answer has to be a property of
 * the drawing rather than of how the code happened to walk it.
 */

let session: EditorSession;

const addWall = (a: Point, b: Point) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3 });

const room = (x0: number, y0: number, x1: number, y1: number) => {
  const c = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return c.map((a, i) => addWall(a, c[(i + 1) % c.length]));
};

const resize = (id: EntityId, length: number, spread?: 'push' | 'absorb') =>
  resizeWallLength(
    (name, params) => session.dispatch(name, params),
    session.doc,
    id,
    length,
    spread,
  );

const of = (id: EntityId) => {
  const { a, b } = (session.doc.get(id) as WallEntity).getBaseline();
  return {
    length: Math.hypot(b.x - a.x, b.y - a.y),
    /** degrees, and undirected — 90 and -90 are the same bearing on a plan */
    angle: ((Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI + 360) % 180,
    a,
    b,
  };
};

/** two rooms side by side sharing one wall: R1 x 0..4, R2 x 4..7, both 3 deep */
function twoRooms() {
  const [bottom, right, top, left] = room(0, 0, 4, 3);
  const farBottom = addWall(point(4, 0), point(7, 0));
  const farRight = addWall(point(7, 0), point(7, 3));
  const farTop = addWall(point(7, 3), point(4, 3));
  return { bottom, right, top, left, farBottom, farRight, farTop };
}

beforeEach(() => {
  session = new EditorSession();
});

describe('the room being resized', () => {
  it('grows to the length asked for and stays square', () => {
    const r = twoRooms();
    resize(r.bottom, 6);
    expect(of(r.bottom).length).toBeCloseTo(6, 6);
    expect(of(r.top).length).toBeCloseTo(6, 6); // the facing wall follows
    expect(of(r.right).length).toBeCloseTo(3, 6); // the cross walls do not grow
    expect(of(r.left).length).toBeCloseTo(3, 6);
    expect(of(r.right).angle).toBeCloseTo(90, 6);
  });

  it('holds the joined end still and moves the other', () => {
    const r = twoRooms();
    resize(r.bottom, 6);
    expect(of(r.left).a).toEqual({ x: 0, y: 3 }); // untouched side
    expect(of(r.bottom).a).toEqual({ x: 0, y: 0 });
  });

  it('keeps an angled wall at its own bearing while the room grows', () => {
    // the resize slides one corner; a wall meeting it at 56 degrees must be
    // carried, not stretched, or the room quietly changes shape
    const bottom = addWall(point(0, 0), point(4, 0));
    const angled = addWall(point(4, 0), point(6, 3));
    const top = addWall(point(6, 3), point(0, 3));
    addWall(point(0, 3), point(0, 0));
    const before = of(angled);
    resize(bottom, 6);
    expect(of(angled).angle).toBeCloseTo(before.angle, 6);
    expect(of(angled).length).toBeCloseTo(before.length, 6);
    expect(of(top).length).toBeCloseTo(8, 6);
  });
});

describe('the room next door', () => {
  /*
   * The regression this file exists for. Carrying used to be decided by
   * distance through the join graph — neighbour rigid, one step further
   * stretched — so a second room straddling that boundary was sheared: its
   * near wall translated while its far wall stretched to catch up. Growing
   * R1 from 4.00 to 6.00 rotated R2's right wall to 123.7 degrees and cut
   * R2's top wall from 3.00 to 1.00.
   */
  it('is pushed along whole, keeping every length and angle', () => {
    const r = twoRooms();
    resize(r.bottom, 6, 'push');
    expect(of(r.farBottom).length).toBeCloseTo(3, 6);
    expect(of(r.farRight).length).toBeCloseTo(3, 6);
    expect(of(r.farTop).length).toBeCloseTo(3, 6);
    expect(of(r.farRight).angle).toBeCloseTo(90, 6); // was 123.7
    expect(of(r.farTop).angle).toBeCloseTo(0, 6);
  });

  it('moves by exactly what the wall grew by', () => {
    const r = twoRooms();
    resize(r.bottom, 6, 'push');
    expect(of(r.farRight).a).toEqual({ x: 9, y: 0 });
    expect(of(r.farRight).b).toEqual({ x: 9, y: 3 });
  });

  it('gives up the difference instead, when absorbing', () => {
    const r = twoRooms();
    resize(r.bottom, 6, 'absorb');
    expect(of(r.farBottom).length).toBeCloseTo(1, 6); // 3.00 - 2.00
    expect(of(r.farTop).length).toBeCloseTo(1, 6);
    expect(of(r.farRight).a).toEqual({ x: 7, y: 0 }); // outer wall stays put
    expect(of(r.farRight).length).toBeCloseTo(3, 6);
  });

  it('keeps its angles square either way', () => {
    for (const spread of ['push', 'absorb'] as const) {
      session = new EditorSession();
      const r = twoRooms();
      resize(r.bottom, 6, spread);
      expect(of(r.farRight).angle).toBeCloseTo(90, 6);
      expect(of(r.farTop).angle).toBeCloseTo(0, 6);
      expect(of(r.farBottom).angle).toBeCloseTo(0, 6);
    }
  });
});

describe('what a resize refuses to do', () => {
  it('will not shorten a neighbour out of existence', () => {
    // R2 is 3 m wide; absorbing a 3 m growth would leave it nothing at all
    const r = twoRooms();
    expect(planWallResize(session.doc, r.bottom, 7, 'absorb')).toBeNull();
    // and pushing the same edit is fine, because nothing has to give
    expect(planWallResize(session.doc, r.bottom, 7, 'push')).not.toBeNull();
  });

  it('leaves the plan untouched when it refuses', () => {
    const r = twoRooms();
    resize(r.bottom, 7, 'absorb');
    expect(of(r.bottom).length).toBeCloseTo(4, 6);
    expect(of(r.farTop).length).toBeCloseTo(3, 6);
  });

  it('does not reach a building it is not joined to', () => {
    // "everything beyond the corner" would otherwise sweep up anything that
    // merely happens to sit further along the same axis
    const r = twoRooms();
    const separate = addWall(point(20, 0), point(24, 0));
    resize(r.bottom, 6, 'push');
    expect(of(separate).a).toEqual({ x: 20, y: 0 });
    expect(of(separate).b).toEqual({ x: 24, y: 0 });
  });
});

describe('a wall on its own', () => {
  it('grows about its middle, since there is nothing to hold', () => {
    const lone = addWall(point(0, 0), point(4, 0));
    resize(lone, 6);
    expect(of(lone).a).toEqual({ x: -1, y: 0 });
    expect(of(lone).b).toEqual({ x: 5, y: 0 });
  });
});
