import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, Point, ViewDefinition } from '@acip/editor-core';
import type { MeasureMode } from '@/editor/ui-state';
import type {
  PlanDimension,
  PlanExtent,
} from '@/editor/viewport/wall-dimensions';
import {
  layOutDimensions,
  planDimensions,
  wallExtent,
} from '@/editor/viewport/wall-dimensions';

/**
 * The two-sided wall rule (docs/editor-core/04-systems/dimensions.md): the plan
 * measures either the OUTER overall extent — the wall as drawn, outer corner to
 * outer corner — or the INNER clear width, face to face, which is what a tape
 * run inside a room reads.
 *
 * Inside measures the face pointing INTO the plan, and draws the dimension on
 * that same side: a clear width printed out beyond the outer face describes a
 * room from outside it, where no tape can be laid. So the toggle moves the
 * numbers AND flips the stand-off, together.
 *
 * What it does not move is the lane, which is assigned from the baselines
 * before anything is measured — the same plan lays out deterministically in
 * both modes.
 */

const PLAN: ViewDefinition = { kind: 'plan', levelId: null };
/** every wall here is this thick, so the expected numbers can be read off */
const THICKNESS = 0.3;

let session: EditorSession;

const addWall = (a: Point, b: Point, thickness = THICKNESS) =>
  session.dispatch<EntityId>('WALL.ADD', { a, b, thickness });

/** closed loop, so every wall is mitered into a corner at both ends */
const room = (
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  t = THICKNESS,
) => {
  const corners = [point(x0, y0), point(x1, y0), point(x1, y1), point(x0, y1)];
  return corners.map((a, i) =>
    addWall(a, corners[(i + 1) % corners.length], t),
  );
};

const addWindow = (wallId: EntityId, t: number, width: number) =>
  session.dispatch<EntityId>('WINDOW.ADD', { wallId, t, width });

const dims = (mode: MeasureMode) =>
  planDimensions(session.doc, PLAN, new Set(), mode);

/** the dimension drawn against one entity — a miss is a failure, not a maybe */
const dimOf = (id: EntityId, mode: MeasureMode): PlanDimension => {
  const found = dims(mode).find((d) => d.entityId === id);
  if (!found) throw new Error(`nothing measures ${id} in ${mode} mode`);
  return found;
};

/** the raw extent of one wall, faces included */
const extentOf = (id: EntityId): PlanExtent => {
  const wall = session.doc.get(id);
  if (!(wall instanceof WallEntity)) throw new Error(`${id} is not a wall`);
  const extent = wallExtent(wall);
  if (!extent) throw new Error(`${id} has nothing to measure`);
  return extent;
};

/** the dimension's own anchors, as a length — must equal the reported length */
const spanOf = (d: { a: Point; b: Point }) =>
  Math.hypot(d.b.x - d.a.x, d.b.y - d.a.y);

const rounded = (mode: MeasureMode) =>
  dims(mode)
    .map((d) => Math.round(d.length * 100) / 100)
    .sort();

/** a bare dimension for the layout function, without a document — no faces */
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

describe('a rectangular room, measured both ways', () => {
  it('measures outer corner to outer corner outside, clear width inside', () => {
    const [bottom] = room(0, 0, 6, 4);
    const outer = dimOf(bottom, 'outside');
    const inner = dimOf(bottom, 'inside');

    // 6 m centreline plus half a thickness of miter at each end
    expect(outer.length).toBeCloseTo(6.3, 6);
    // and the clear width between the two side walls' inner faces
    expect(inner.length).toBeCloseTo(5.7, 6);
    expect(inner.length).toBeCloseTo(outer.length - 2 * THICKNESS, 6);
  });

  it('gives up exactly one wall thickness at each end', () => {
    const [bottom] = room(0, 0, 6, 4);
    const outer = dimOf(bottom, 'outside');
    const inner = dimOf(bottom, 'inside');

    // outer corner at −0.15, inner corner at +0.15: this wall's own outer half
    // plus the outer half of the wall it turns into
    expect(outer.a.x).toBeCloseTo(-0.15, 6);
    expect(inner.a.x).toBeCloseTo(0.15, 6);
    expect(outer.b.x).toBeCloseTo(6.15, 6);
    expect(inner.b.x).toBeCloseTo(5.85, 6);
    expect(inner.a.x - outer.a.x).toBeCloseTo(THICKNESS, 6);
    expect(outer.b.x - inner.b.x).toBeCloseTo(THICKNESS, 6);
  });

  it('keeps the anchors on the wall line itself', () => {
    const [bottom] = room(0, 0, 6, 4);
    const inner = dimOf(bottom, 'inside');
    // the face is half a thickness off the baseline; the DIMENSION is not. It
    // borrows the face's span only, so it still lines up with its own wall.
    expect(inner.a.y).toBeCloseTo(0, 9);
    expect(inner.b.y).toBeCloseTo(0, 9);
  });

  it('shrinks all four walls by a thickness at each end', () => {
    room(0, 0, 6, 4);
    expect(rounded('outside')).toEqual([4.3, 4.3, 6.3, 6.3]);
    expect(rounded('inside')).toEqual([3.7, 3.7, 5.7, 5.7]);
  });

  it('reads the face facing into the plan, on every side', () => {
    // the rule itself: outside stands its dimension off away from the middle of
    // the plan, and inside measures — and draws — the other face, the one
    // somebody standing in the room would hold a tape against
    const ids = room(0, 0, 6, 4);
    for (const id of ids) {
      const outer = dimOf(id, 'outside');
      const inner = dimOf(id, 'inside');
      // drawn on the room side: exactly opposite where the overall one goes
      expect(inner.side.x).toBeCloseTo(-outer.side.x, 9);
      expect(inner.side.y).toBeCloseTo(-outer.side.y, 9);

      const towards = (outer.faces ?? []).filter(
        (face) =>
          face.normal.x * outer.side.x + face.normal.y * outer.side.y < 0,
      );
      expect(towards).toHaveLength(1);
      expect(inner.length).toBeCloseTo(towards[0].length, 9);
      expect(inner.a).toEqual(towards[0].a);
      expect(inner.b).toEqual(towards[0].b);
      expect(inner.length).toBeLessThan(outer.length);
    }
  });

  it('draws the clear width inside the room it belongs to', () => {
    // the complaint this rule answers: an inside dimension standing off beyond
    // the outer face is a room's width quoted from the pavement. Stepping from
    // each anchor along `side` has to land INSIDE the room, not outside it.
    for (const id of room(0, 0, 6, 4)) {
      const inner = dimOf(id, 'inside');
      const mid = {
        x: (inner.a.x + inner.b.x) / 2 + inner.side.x * 0.5,
        y: (inner.a.y + inner.b.y) / 2 + inner.side.y * 0.5,
      };
      expect(mid.x).toBeGreaterThan(0);
      expect(mid.x).toBeLessThan(6);
      expect(mid.y).toBeGreaterThan(0);
      expect(mid.y).toBeLessThan(4);
    }
  });

  it('scales the clear width with the wall thickness', () => {
    // fatter walls on the same centrelines: the room inside them is smaller
    const ids = room(0, 0, 6, 4, 0.6);
    expect(dimOf(ids[0], 'outside').length).toBeCloseTo(6.6, 6);
    expect(dimOf(ids[0], 'inside').length).toBeCloseTo(5.4, 6);
  });
});

describe('a clear width stops at a face, never at a centreline', () => {
  /**
   * The plan from the report: a 6x4 room with two partitions dropped off its
   * top wall, which WALL.RESOLVE splits into three segments. Each segment then
   * ends AT the partition — on the partition's centreline, not its face.
   */
  const withPartitions = () => {
    const walls = room(0, 0, 6, 4);
    addWall(point(3, 4), point(3, 1.4));
    addWall(point(4.5, 4), point(4.5, 1.4));
    session.dispatch('WALL.RESOLVE', {});
    return walls;
  };

  it('gives up half a partition at each end it runs into one', () => {
    withPartitions();
    const bays = dims('inside')
      .filter((d) => Math.abs(d.a.y - 4) < 1e-9 && Math.abs(d.b.y - 4) < 1e-9)
      .map((d) => Math.round(d.length * 100) / 100)
      .sort();

    // 2.85 / 1.50 / 1.35 were the centreline-to-centreline figures: each end
    // landing on a partition gives up its half-thickness
    expect(bays).toEqual([1.2, 1.2, 2.7]);
  });

  it('stops the bays short of adding up to the wall below them', () => {
    // the tell in the report: three bays summing to exactly the 5.70 m wall
    // opposite proves they were measured to the centrelines, since the two
    // partitions between them occupy 0.60 m of that span
    withPartitions();
    const bays = dims('inside').filter(
      (d) => Math.abs(d.a.y - 4) < 1e-9 && Math.abs(d.b.y - 4) < 1e-9,
    );
    const across = dims('inside').find(
      (d) => Math.abs(d.a.y) < 1e-9 && Math.abs(d.b.y) < 1e-9,
    );

    const total = bays.reduce((sum, d) => sum + d.length, 0);
    expect(across?.length).toBeCloseTo(5.7, 6);
    expect(total).toBeCloseTo(5.7 - 2 * THICKNESS, 6);
  });

  it('leaves the overall extents alone', () => {
    // outside measures the wall as drawn, and a wall drawn through a junction
    // really does run to it — the setback is the inner face's business
    withPartitions();
    const bays = dims('outside')
      .filter((d) => Math.abs(d.a.y - 4) < 1e-9 && Math.abs(d.b.y - 4) < 1e-9)
      .map((d) => Math.round(d.length * 100) / 100)
      .sort();
    expect(bays).toEqual([1.5, 1.65, 3.15]);
  });

  it('leaves a partition alone at the end that tees in', () => {
    // it tees into the top wall, so its cap already stops at that wall's face:
    // there is nothing further to give up, and it must not be cut twice
    withPartitions();
    const spur = dims('inside').find(
      (d) => Math.abs(d.a.x - 3) < 1e-9 && Math.abs(d.b.x - 3) < 1e-9,
    );
    expect(spur?.length).toBeCloseTo(2.45, 6);
  });
});

describe('the line and the number never disagree', () => {
  it('reports a length that matches its own anchors, in both modes', () => {
    const walls = room(0, 0, 6, 4);
    addWindow(walls[0], 0.4, 1.2);
    addWall(point(12, 0), point(15, 4)); // free-standing, angled

    for (const mode of ['outside', 'inside'] as const) {
      for (const dim of dims(mode)) {
        expect(spanOf(dim)).toBeCloseTo(dim.length, 9);
      }
    }
  });

  it('never emits a NaN into the viewport', () => {
    // a mitered room, a wall teed into one of its faces, and an opening —
    // every cap shape the plan can produce, each measured against a face
    const walls = room(0, 0, 6, 4);
    addWindow(walls[0], 0.4, 1.2);
    addWall(point(3, 4), point(3, 8));

    for (const dim of dims('inside')) {
      for (const value of [dim.length, dim.a.x, dim.a.y, dim.b.x, dim.b.y]) {
        expect(Number.isFinite(value)).toBe(true);
      }
      expect(dim.length).toBeGreaterThan(0);
    }
  });
});

describe('walls with no two sides to choose between', () => {
  it('measures a free-standing wall the same either way', () => {
    // butt caps square off both faces at the same place, so the two faces span
    // the same stretch — inside IS outside here, and that is correct
    const id = addWall(point(0, 0), point(4, 0));
    expect(dimOf(id, 'outside').length).toBeCloseTo(4, 6);
    expect(dimOf(id, 'inside').length).toBeCloseTo(4, 6);
  });

  it('measures a wall teed into another face the same either way', () => {
    // a tee butts flat against its host's face, so once again both faces stop
    // at the same place. The risk was a face collapsing to nothing; it does not.
    addWall(point(0, 0), point(8, 0));
    const spur = addWall(point(4, 0), point(4, 3));

    // stops short of its own endpoint, at the host's near face
    expect(dimOf(spur, 'outside').length).toBeCloseTo(2.85, 6);
    expect(dimOf(spur, 'inside').length).toBeCloseTo(2.85, 6);
  });

  it('falls back to the drawn extent when there is no face to read', () => {
    // a dimension carrying no faces measures as drawn rather than not at all —
    // but it still moves to the inside, because a wall's dimension and its
    // window's must not end up on opposite sides of the wall
    const input = [bare('w', point(0, 0), point(4, 0))];
    const [inner] = layOutDimensions(input, point(2, 4), 'inside');
    const [outer] = layOutDimensions(input, point(2, 4), 'outside');
    expect(inner.length).toBeCloseTo(outer.length, 9);
    expect(inner.a).toEqual(outer.a);
    expect(inner.b).toEqual(outer.b);
    expect(inner.lane).toBe(outer.lane);
    expect(inner.side.y).toBeCloseTo(-outer.side.y, 9);
  });

  it('carries a face for each side of a wall, on opposite normals', () => {
    const [bottom] = room(0, 0, 6, 4);
    const faces = extentOf(bottom).faces ?? [];
    expect(faces).toHaveLength(2);
    const [plus, minus] = faces;
    const dot = plus.normal.x * minus.normal.x + plus.normal.y * minus.normal.y;
    expect(dot).toBeCloseTo(-1, 9);
    // face+ is left of travel, which for this loop is the room side
    expect(plus.length).toBeCloseTo(5.7, 6);
    expect(minus.length).toBeCloseTo(6.3, 6);
  });
});

describe('openings', () => {
  it('measures an opening the same in both modes', () => {
    // an opening is a hole: the same width against the near face of the wall as
    // against the far one, so inside mode has nothing to choose between
    const walls = room(0, 0, 8, 5);
    const window = addWindow(walls[0], 0.4, 1.2);
    const inner = dimOf(window, 'inside');
    const outer = dimOf(window, 'outside');

    expect(inner.length).toBeCloseTo(outer.length, 9);
    expect(inner.a).toEqual(outer.a);
    expect(inner.b).toEqual(outer.b);
    expect(inner.length).toBeCloseTo(1.2, 6);
  });

  it('takes an opening into the room with its host', () => {
    // the width does not change, but WHERE it is drawn must: a window's number
    // left outside while its wall's went in would read as measuring a different
    // wall, and the two would stop sharing lanes at exactly the moment they
    // need to
    const walls = room(0, 0, 8, 5);
    const window = addWindow(walls[0], 0.4, 1.2);

    const host = dimOf(walls[0], 'inside');
    const hole = dimOf(window, 'inside');
    expect(hole.side).toEqual(host.side);
    expect(hole.lane).toBeGreaterThan(host.lane);
  });

  it('leaves the opening alone even as its host shrinks', () => {
    const walls = room(0, 0, 8, 5);
    const window = addWindow(walls[0], 0.4, 1.2);

    expect(dimOf(walls[0], 'inside').length).toBeLessThan(
      dimOf(walls[0], 'outside').length,
    );
    expect(dimOf(window, 'inside').length).toBeCloseTo(
      dimOf(window, 'outside').length,
      9,
    );
  });
});

describe('lanes are decided before anything is measured', () => {
  /** entity → the lane it was given, with the measured span left out */
  const layout = (mode: MeasureMode) =>
    dims(mode).map((d) => ({
      id: d.entityId,
      lane: d.lane,
      selected: d.selected,
    }));

  /** every dimension's stand-off, keyed by entity */
  const sides = (mode: MeasureMode) =>
    new Map(dims(mode).map((d) => [d.entityId, d.side]));

  /** inside turns every stand-off around, and nothing else about placement */
  const expectMirrored = () => {
    const outer = sides('outside');
    for (const [id, side] of sides('inside')) {
      const was = outer.get(id);
      expect(was).toBeDefined();
      expect(side.x).toBeCloseTo(-(was?.x ?? NaN), 9);
      expect(side.y).toBeCloseTo(-(was?.y ?? NaN), 9);
    }
  };

  it('lanes a room and its windows identically in either mode', () => {
    const walls = room(0, 0, 8, 5);
    addWindow(walls[0], 0.4, 1.2);
    addWindow(walls[2], 0.6, 0.9);
    expect(layout('inside')).toEqual(layout('outside'));
    expectMirrored();
  });

  it('lanes two walls on one line the same way in either mode', () => {
    // the colliding case: one line, overlapping spans, so they take separate
    // lanes — and inside mode must not reshuffle them
    addWall(point(0, 4), point(6, 4));
    addWall(point(0, 4), point(9, 4));
    expect(layout('inside')).toEqual(layout('outside'));
    expectMirrored();
    expect(
      dims('inside')
        .map((d) => d.lane)
        .sort(),
    ).toEqual([0, 1]);
  });

  it('stands an opening clear of its host in either mode', () => {
    const wall = addWall(point(0, 0), point(10, 0));
    const id = addWindow(wall, 0.3, 1.2);
    expect(dimOf(wall, 'inside').lane).toBe(0);
    expect(dimOf(id, 'inside').lane).toBe(1);
  });

  it('de-duplicates the same walls in either mode', () => {
    // one wall drawn straight over another: only one number can be read, and
    // which wall wins is decided from the baselines, not from the faces
    addWall(point(0, 0), point(6, 0));
    addWall(point(0, 0), point(6, 0));
    expect(dims('inside')).toHaveLength(1);
    expect(dims('inside')[0].entityId).toBe(dims('outside')[0].entityId);
  });

  it('numbers all three walls of a stacked column in either mode', () => {
    // the plan that made lanes necessary: three horizontals between the same
    // two x values at three heights. Inside mode re-measures all three and
    // must not merge any of them.
    const top = addWall(point(0, 10), point(4.5, 10));
    const mid = addWall(point(0, 5), point(4.5, 5));
    const bot = addWall(point(0, 0), point(4.5, 0));
    addWall(point(0, 0), point(0, 10));
    addWall(point(4.5, 0), point(4.5, 10));
    addWall(point(4.5, 10), point(8, 10));
    addWall(point(8, 10), point(8, 5));
    addWall(point(8, 5), point(4.5, 5));

    expect(layout('inside')).toEqual(layout('outside'));
    for (const id of [top, mid, bot]) {
      expect(dimOf(id, 'inside').length).toBeLessThanOrEqual(
        dimOf(id, 'outside').length + 1e-9,
      );
      expect(dimOf(id, 'inside').length).toBeGreaterThan(0);
    }
  });

  it('is still deterministic in inside mode', () => {
    room(0, 0, 6, 4);
    expect(dims('inside')).toEqual(dims('inside'));
  });

  it('defaults to the outside extents', () => {
    // the setting must not change the drawing the moment it exists: a caller
    // that never heard of it keeps the plan it always had
    room(0, 0, 6, 4);
    expect(planDimensions(session.doc, PLAN)).toEqual(dims('outside'));
  });
});
