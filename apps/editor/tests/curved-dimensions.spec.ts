import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import { planDimensions, wallExtent } from '@/editor/viewport/wall-dimensions';

/**
 * What the plan prints against a BOWED wall.
 *
 * A curved wall is measured round the boundary the current mode names, not
 * across the chord it leaves behind: inside prints the inner arc, outside
 * prints the outer one, and both come with the depth of that same arc. The
 * numbers below are worked out from the circle rather than read off the
 * implementation, so a formula that drifts cannot agree with itself.
 */

const PLAN: ViewDefinition = { kind: 'plan', levelId: null };
const THICK = 0.3;

let session: EditorSession;

const addWall = (a: Point, b: Point, thickness = THICK) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness });

const bend = (id: EntityId, sweep: number) =>
  session.dispatch('WALL.SETARC', { ids: [id], sweep });

const wallOf = (id: EntityId) => session.doc.get(id) as WallEntity;

const dimOf = (id: EntityId, mode: 'inside' | 'outside') =>
  planDimensions(session.doc, PLAN, new Set(), mode).find(
    (dim) => dim.kind === 'wall' && dim.entityId === id,
  );

/** the length the plan prints for this wall in this mode */
const printed = (id: EntityId, mode: 'inside' | 'outside') => {
  const dim = dimOf(id, mode);
  if (!dim) throw new Error('no dimension for that wall');
  return dim.length;
};

/** the circle a chord and a sweep make, from first principles */
const circle = (chord: number, sweep: number) => {
  const radius = chord / 2 / Math.sin(Math.abs(sweep) / 2);
  return {
    radius,
    /** arc length of the boundary `offset` further out than the centreline */
    arc: (offset: number) => (radius + offset) * Math.abs(sweep),
    /** rise of that same boundary from its own chord */
    rise: (offset: number) =>
      (radius + offset) * (1 - Math.cos(Math.abs(sweep) / 2)),
  };
};

/** a 4 m wall along +x, alone on the plan, bowed by `sweep` */
const lone = (sweep: number, thickness = THICK) => {
  const id = addWall(point(0, 0), point(4, 0), thickness);
  bend(id, sweep);
  return id;
};

/**
 * The room from the screenshots: 4 m baselines, 0.30 m walls, the top one
 * bowed away from the room.
 */
const roomWithBowedTop = (sweep = Math.PI / 3) => {
  const corners = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
  const ids = corners.map((a, i) => addWall(a, corners[(i + 1) % 4]));
  // walls run anticlockwise, so the top one runs +x→−x and its face+ normal
  // points down into the room: bowing it AWAY from the room is a negative sweep
  bend(ids[2], -sweep);
  return { ids, top: ids[2] };
};

beforeEach(() => {
  session = new EditorSession();
});

describe('what a bowed wall measures', () => {
  const SWEEP = Math.PI / 3;

  it('prints the OUTER arc in outside mode', () => {
    const id = lone(SWEEP);
    const ring = circle(4, SWEEP);
    expect(printed(id, 'outside')).toBeCloseTo(ring.arc(THICK / 2), 6);
  });

  it('prints the INNER arc in inside mode', () => {
    const id = lone(SWEEP);
    const ring = circle(4, SWEEP);
    expect(printed(id, 'inside')).toBeCloseTo(ring.arc(-THICK / 2), 6);
  });

  it('prints neither the chord nor the centreline arc', () => {
    // the chord is what distance(a, b) gives and the bug printed; the
    // centreline arc is what getLength() gives, which is a third number again
    const id = lone(SWEEP);
    const centreline = wallOf(id).getLength();
    for (const mode of ['inside', 'outside'] as const) {
      expect(printed(id, mode)).not.toBeCloseTo(4, 3);
      expect(printed(id, mode)).not.toBeCloseTo(centreline, 3);
    }
  });

  it('puts the outer arc outside the centreline and the inner arc inside it', () => {
    const id = lone(SWEEP);
    const centreline = wallOf(id).getLength();
    expect(printed(id, 'outside')).toBeGreaterThan(centreline);
    expect(printed(id, 'inside')).toBeLessThan(centreline);
  });

  it('separates the two boundaries by a whole thickness of arc', () => {
    // the two faces are concentric, so their lengths differ by sweep × t
    const id = lone(SWEEP);
    expect(printed(id, 'outside') - printed(id, 'inside')).toBeCloseTo(
      SWEEP * THICK,
      6,
    );
  });

  it('opens that gap wider for a thicker wall', () => {
    const spread = (thickness: number) => {
      session = new EditorSession();
      const id = lone(SWEEP, thickness);
      return printed(id, 'outside') - printed(id, 'inside');
    };
    expect(spread(0.5)).toBeGreaterThan(spread(0.1));
  });
});

describe('the depth of the bow', () => {
  const SWEEP = Math.PI / 3;

  it('is the rise of the OUTER arc in outside mode', () => {
    const id = lone(SWEEP);
    const ring = circle(4, SWEEP);
    expect(dimOf(id, 'outside')?.curve?.depth).toBeCloseTo(
      ring.rise(THICK / 2),
      6,
    );
  });

  it('is the rise of the INNER arc in inside mode', () => {
    const id = lone(SWEEP);
    const ring = circle(4, SWEEP);
    expect(dimOf(id, 'inside')?.curve?.depth).toBeCloseTo(
      ring.rise(-THICK / 2),
      6,
    );
  });

  it('stands the apex off the chord by exactly that much', () => {
    // the depth has to be the distance from the chord between the dimension's
    // own two anchors to its own apex, or the arrow is drawn lying
    const id = lone(SWEEP);
    const dim = dimOf(id, 'outside');
    const curve = dim?.curve;
    if (!dim || !curve) throw new Error('no curved dimension');
    const dx = dim.b.x - dim.a.x;
    const dy = dim.b.y - dim.a.y;
    const len = Math.hypot(dx, dy);
    const off = Math.abs(
      ((curve.apex.x - dim.a.x) * -dy + (curve.apex.y - dim.a.y) * dx) / len,
    );
    expect(off).toBeCloseTo(curve.depth, 9);
  });

  it('grows with the bow and vanishes as the wall straightens', () => {
    const shallow = lone(0.05);
    const shallowDepth = dimOf(shallow, 'outside')?.curve?.depth ?? 0;
    session = new EditorSession();
    const deep = lone(Math.PI * 0.9);
    const deepDepth = dimOf(deep, 'outside')?.curve?.depth ?? 0;
    expect(shallowDepth).toBeGreaterThan(0);
    expect(deepDepth).toBeGreaterThan(shallowDepth);
  });
});

describe('whichever way it bows', () => {
  it('offers the same two boundaries whichever way the wall bows', () => {
    // WHICH of them is inside is the plan's business and a lone wall gives it
    // nothing to go on; what must not change with the sign of the sweep is the
    // pair of arcs there is to choose between
    const both = (sweep: number) => {
      session = new EditorSession();
      const id = lone(sweep);
      return [printed(id, 'inside'), printed(id, 'outside')].sort();
    };
    const ring = circle(4, Math.PI / 3);
    const wanted = [ring.arc(-THICK / 2), ring.arc(THICK / 2)].sort();
    for (const pair of [both(Math.PI / 3), both(-Math.PI / 3)]) {
      expect(pair[0]).toBeCloseTo(wanted[0], 6);
      expect(pair[1]).toBeCloseTo(wanted[1], 6);
    }
  });

  it('measures a wall drawn end-to-start exactly as one drawn start-to-end', () => {
    const forward = lone(Math.PI / 3);
    const lengths = [printed(forward, 'inside'), printed(forward, 'outside')];
    session = new EditorSession();
    // the same wall, drawn the other way round: b→a with the sweep flipped, so
    // it bows over the same ground
    const back = addWall(point(4, 0), point(0, 0));
    bend(back, -Math.PI / 3);
    expect(printed(back, 'inside')).toBeCloseTo(lengths[0], 6);
    expect(printed(back, 'outside')).toBeCloseTo(lengths[1], 6);
  });

  it('survives a bow close to a half turn', () => {
    const id = lone(Math.PI * 0.98);
    const ring = circle(4, Math.PI * 0.98);
    expect(printed(id, 'outside')).toBeCloseTo(ring.arc(THICK / 2), 6);
    expect(printed(id, 'inside')).toBeCloseTo(ring.arc(-THICK / 2), 6);
  });

  it('survives a bow past a half turn', () => {
    const id = lone(Math.PI * 1.5);
    const ring = circle(4, Math.PI * 1.5);
    expect(printed(id, 'outside')).toBeCloseTo(ring.arc(THICK / 2), 6);
    expect(printed(id, 'inside')).toBeCloseTo(ring.arc(-THICK / 2), 6);
  });

  it('still answers when the bend is tighter than the wall is thick', () => {
    // the inner boundary has no radius left to run along; a number is still
    // better than a dimension that disappears
    const id = addWall(point(0, 0), point(1, 0), 2);
    bend(id, Math.PI * 1.9);
    expect(Number.isFinite(printed(id, 'inside'))).toBe(true);
    expect(Number.isFinite(printed(id, 'outside'))).toBe(true);
  });
});

describe('a bowed wall in a room', () => {
  it('reads shorter inside than outside', () => {
    const { top } = roomWithBowedTop();
    expect(printed(top, 'inside')).toBeLessThan(printed(top, 'outside'));
  });

  it('is cut back by the corners it is mitered into, like any other wall', () => {
    // its inner face stops where core drew the miter, so the clear arc is
    // shorter than the full inner arc between the baseline endpoints
    const { top } = roomWithBowedTop();
    const ring = circle(4, Math.PI / 3);
    expect(printed(top, 'inside')).toBeLessThan(ring.arc(-THICK / 2));
  });

  it('measures the boundary on the side the mode names, bowing either way', () => {
    /*
     * The test that actually pins the requirement down, and it is not "inside
     * is shorter": a wall bowing INTO the room has its room-facing boundary on
     * the far side of the arc's centre, so that boundary has the LARGER radius
     * — while the miters at its two corners cut it back further than the extra
     * radius adds. Which is longer therefore depends on the room.
     *
     * What must hold whichever way it bows is which boundary each mode picks:
     * the one facing the room for inside, the one facing away for outside, a
     * wall thickness apart in radius.
     */
    const toMiddle = (p: Point | undefined) =>
      Math.hypot((p?.x ?? 0) - 2, (p?.y ?? 0) - 2);
    for (const bow of [Math.PI / 3, -Math.PI / 3]) {
      session = new EditorSession();
      const { top } = roomWithBowedTop(bow);
      const inside = dimOf(top, 'inside')?.curve;
      const outside = dimOf(top, 'outside')?.curve;
      if (!inside || !outside) throw new Error('no curved dimension');
      expect(toMiddle(inside.apex)).toBeLessThan(toMiddle(outside.apex));
      expect(Math.abs(outside.radius - inside.radius)).toBeCloseTo(THICK, 9);
    }
  });

  it('leaves the straight wall across the room printing what it always did', () => {
    // the two walls MITERED into the bowed one meet it on its tangent now, so
    // their corners have genuinely moved and their extents move with them -
    // that is core's cap geometry, and it is what the plan draws. The wall
    // that does not touch it must not move at all.
    const { ids } = roomWithBowedTop();
    expect(printed(ids[0], 'outside')).toBeCloseTo(4.3, 6);
    expect(printed(ids[0], 'inside')).toBeCloseTo(3.7, 6);
  });
});

describe('what a straight wall still gets', () => {
  it('no curve, in either mode', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(dimOf(id, 'outside')?.curve).toBeUndefined();
    expect(dimOf(id, 'inside')?.curve).toBeUndefined();
    expect(wallExtent(wallOf(id))?.curve).toBeUndefined();
  });

  it('the same numbers a room has always printed', () => {
    const corners = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    const ids = corners.map((a, i) => addWall(a, corners[(i + 1) % 4]));
    for (const id of ids) {
      expect(printed(id, 'outside')).toBeCloseTo(4.3, 6);
      expect(printed(id, 'inside')).toBeCloseTo(3.7, 6);
    }
  });

  it('its extent measured end to end, unchanged', () => {
    const id = addWall(point(0, 0), point(4, 0));
    expect(wallExtent(wallOf(id))?.length).toBeCloseTo(4, 9);
  });
});
