import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  JOIN_TOLERANCE,
  WallEntity,
  WindowEntity,
  detectSpaces,
  isUnchanged,
  planSegmentOverlaps,
  point,
} from '../src/index.js';
import type { EntityId, LayerId, OverlapSegment, Point } from '../src/index.js';

const seg = (
  id: string,
  ax: number,
  ay: number,
  bx: number,
  by: number,
): OverlapSegment => ({ id, a: point(ax, ay), b: point(bx, by) });

const plan = (segments: OverlapSegment[]) =>
  planSegmentOverlaps(segments, JOIN_TOLERANCE);

/** every kept piece as `id:ax,ay→bx,by`, rounded, for readable assertions */
const kept = (segments: OverlapSegment[]): string[] =>
  plan(segments).flatMap((p) =>
    p.keep.map(
      (k) =>
        `${p.id}:${k.a.x.toFixed(2)},${k.a.y.toFixed(2)}→${k.b.x.toFixed(
          2,
        )},${k.b.y.toFixed(2)}`,
    ),
  );

describe('planSegmentOverlaps', () => {
  test('leaves walls that do not touch alone', () => {
    const plans = plan([seg('a', 0, 0, 4, 0), seg('b', 0, 3, 4, 3)]);
    expect(plans.every((p) => p.keep.length === 1)).toBe(true);
    expect(plans.every((p) => p.dropped.length === 0)).toBe(true);
  });

  test('endpoint-to-endpoint needs no split', () => {
    const plans = plan([seg('a', 0, 0, 4, 0), seg('b', 4, 0, 4, 3)]);
    expect(plans.map((p) => p.keep.length)).toEqual([1, 1]);
  });

  test('endpoint-to-middle splits the host at the tee', () => {
    // b's end lands halfway along a
    expect(kept([seg('a', 0, 0, 4, 0), seg('b', 2, 0, 2, 3)])).toEqual([
      'a:0.00,0.00→2.00,0.00',
      'a:2.00,0.00→4.00,0.00',
      'b:2.00,0.00→2.00,3.00',
    ]);
  });

  test('middle-to-middle crossing splits both', () => {
    expect(kept([seg('a', 0, 0, 4, 0), seg('b', 2, -2, 2, 2)])).toEqual([
      'a:0.00,0.00→2.00,0.00',
      'a:2.00,0.00→4.00,0.00',
      'b:2.00,-2.00→2.00,0.00',
      'b:2.00,0.00→2.00,2.00',
    ]);
  });

  test('partial collinear overlap: A—C—D—B, the shared run kept once', () => {
    // A ------------------- B   with   C ------ D inside it
    expect(kept([seg('A', 0, 0, 10, 0), seg('B', 3, 0, 7, 0)])).toEqual([
      'A:0.00,0.00→3.00,0.00',
      'A:3.00,0.00→7.00,0.00',
      'A:7.00,0.00→10.00,0.00',
    ]);
    // the second segment contributed nothing: its only piece was the shared run
    const plans = plan([seg('A', 0, 0, 10, 0), seg('B', 3, 0, 7, 0)]);
    expect(plans[1].keep).toEqual([]);
    expect(plans[1].dropped).toHaveLength(1);
  });

  test('staggered collinear overlap keeps each stretch once', () => {
    // A: 0──6, B: 4──10 — the 4..6 run belongs to A, B keeps 6..10
    expect(kept([seg('A', 0, 0, 6, 0), seg('B', 4, 0, 10, 0)])).toEqual([
      'A:0.00,0.00→4.00,0.00',
      'A:4.00,0.00→6.00,0.00',
      'B:6.00,0.00→10.00,0.00',
    ]);
  });

  test('complete overlap drops the duplicate entirely', () => {
    const plans = plan([seg('A', 0, 0, 4, 0), seg('B', 0, 0, 4, 0)]);
    expect(plans[0].keep).toHaveLength(1);
    expect(plans[1].keep).toEqual([]);
  });

  test('a reversed duplicate is still a duplicate', () => {
    const plans = plan([seg('A', 0, 0, 4, 0), seg('B', 4, 0, 0, 0)]);
    expect(plans[1].keep).toEqual([]);
  });

  test('the first segment wins the shared run, so ids stay stable', () => {
    const plans = plan([seg('older', 0, 0, 10, 0), seg('newer', 3, 0, 7, 0)]);
    expect(plans[0].id).toBe('older');
    expect(plans[0].keep).toHaveLength(3);
    expect(plans[1].keep).toEqual([]);
  });

  test('float dust is not an overlap, and not a split', () => {
    // 1e-9 apart: below tolerance, so this reads as endpoint-to-endpoint
    const plans = plan([seg('a', 0, 0, 4, 0), seg('b', 4 + 1e-9, 0, 4, 3)]);
    expect(plans.map((p) => p.keep.length)).toEqual([1, 1]);
  });

  test('a hair-thin sliver never becomes its own piece', () => {
    // b tees a fraction of a micron from a's end — no 1e-9-long wall
    const plans = plan([seg('a', 0, 0, 4, 0), seg('b', 4 - 1e-9, 0, 2, 3)]);
    expect(plans[0].keep).toHaveLength(1);
  });

  test('degenerate segments are skipped, not returned as pieces', () => {
    expect(plan([seg('dot', 1, 1, 1, 1)])).toEqual([]);
  });

  test('a shared run covered by two crossings splits into three', () => {
    const plans = plan([
      seg('a', 0, 0, 6, 0),
      seg('b', 2, -1, 2, 1),
      seg('c', 4, -1, 4, 1),
    ]);
    expect(plans[0].keep).toHaveLength(3);
  });
});

describe('planSegmentOverlaps — immovable segments', () => {
  const fixed = (
    id: string,
    ax: number,
    ay: number,
    bx: number,
    by: number,
  ): OverlapSegment => ({ ...seg(id, ax, ay, bx, by), immovable: true });

  test('an immovable segment is not cut, but still cuts the other one', () => {
    expect(kept([fixed('a', 0, 0, 4, 0), seg('b', 2, -2, 2, 2)])).toEqual([
      'a:0.00,0.00→4.00,0.00',
      'b:2.00,-2.00→2.00,0.00',
      'b:2.00,0.00→2.00,2.00',
    ]);
  });

  test('an immovable host is not cut by a tee landing on its body', () => {
    const plans = plan([fixed('a', 0, 0, 4, 0), seg('b', 2, 0, 2, 3)]);
    expect(plans[0].keep).toEqual([{ a: point(0, 0), b: point(4, 0) }]);
    expect(plans[0].dropped).toEqual([]);
    expect(plans[1].keep).toHaveLength(1);
  });

  test('the immovable segment wins a shared run even when it comes second', () => {
    const plans = plan([seg('newer', 0, 0, 4, 0), fixed('older', 0, 0, 4, 0)]);
    expect(plans[0].keep).toEqual([]);
    expect(plans[0].dropped).toHaveLength(1);
    expect(plans[1].keep).toHaveLength(1);
  });

  test('a partial overlap is given up by the movable segment', () => {
    // the 4..6 run belongs to the immovable segment, whichever came first
    expect(kept([seg('A', 0, 0, 6, 0), fixed('B', 4, 0, 10, 0)])).toEqual([
      'A:0.00,0.00→4.00,0.00',
      'B:4.00,0.00→10.00,0.00',
    ]);
  });

  test('a movable segment swallowed by an immovable one keeps nothing', () => {
    const plans = plan([fixed('A', 0, 0, 10, 0), seg('B', 3, 0, 7, 0)]);
    expect(plans[0].keep).toHaveLength(1);
    expect(plans[1].keep).toEqual([]);
  });

  test('two immovable segments over each other are both left whole', () => {
    const plans = plan([fixed('A', 0, 0, 6, 0), fixed('B', 4, 0, 10, 0)]);
    expect(plans.every(isUnchanged)).toBe(true);
  });

  test('immovable: false is the plain case, byte for byte', () => {
    const flagged = plan([
      { ...seg('a', 0, 0, 4, 0), immovable: false },
      { ...seg('b', 2, -2, 2, 2), immovable: false },
    ]);
    expect(flagged).toEqual(
      plan([seg('a', 0, 0, 4, 0), seg('b', 2, -2, 2, 2)]),
    );
  });
});

/* -------------------------------------------------------------------------- */
/* WALL.RESOLVE — the same rules applied to real entities                      */
/* -------------------------------------------------------------------------- */

interface Result {
  split: EntityId[];
  created: EntityId[];
  removed: EntityId[];
}

const addWall = (
  session: EditorSession,
  a: Point,
  b: Point,
  extra: Record<string, unknown> = {},
) => session.dispatch<EntityId>('WALL.ADD', { a, b, thickness: 0.3, ...extra });

const walls = (session: EditorSession) =>
  session.doc.all().filter((e): e is WallEntity => e instanceof WallEntity);

const spans = (session: EditorSession) =>
  walls(session)
    .map((w) => {
      const { a, b } = w.getBaseline();
      return `${a.x},${a.y}→${b.x},${b.y}`;
    })
    .sort();

describe('WALL.RESOLVE', () => {
  test('splits the host of a tee and keeps its id', () => {
    const session = new EditorSession();
    const host = addWall(session, point(0, 0), point(4, 0));
    addWall(session, point(2, 0), point(2, 3));

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(result.split).toEqual([host]);
    expect(result.created).toHaveLength(1);
    expect(walls(session)).toHaveLength(3);
    // the original still exists, now as the first half
    const kept = session.doc.get(host) as WallEntity;
    expect(kept.getBaseline()).toEqual({ a: point(0, 0), b: point(2, 0) });
  });

  test('a crossing splits both walls into four', () => {
    const session = new EditorSession();
    addWall(session, point(0, 0), point(4, 0));
    addWall(session, point(2, -2), point(2, 2));

    session.dispatch('WALL.RESOLVE', {});

    expect(walls(session)).toHaveLength(4);
    expect(spans(session)).toEqual([
      '0,0→2,0',
      '2,-2→2,0',
      '2,0→2,2',
      '2,0→4,0',
    ]);
  });

  test('a fully duplicated wall is removed, not left stacked', () => {
    const session = new EditorSession();
    const first = addWall(session, point(0, 0), point(4, 0));
    const second = addWall(session, point(0, 0), point(4, 0));

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(result.removed).toEqual([second]);
    expect(walls(session)).toHaveLength(1);
    expect(session.doc.get(first)).not.toBeNull();
  });

  test('a partial overlap keeps both walls, sharing the run once', () => {
    const session = new EditorSession();
    addWall(session, point(0, 0), point(6, 0));
    addWall(session, point(4, 0), point(10, 0));

    session.dispatch('WALL.RESOLVE', {});

    // 0–4, 4–6 (from the older wall) and 6–10 — the 4–6 run exists once
    expect(spans(session)).toEqual(['0,0→4,0', '4,0→6,0', '6,0→10,0']);
    const total = walls(session).reduce((sum, w) => sum + w.getLength(), 0);
    expect(total).toBeCloseTo(10, 6);
  });

  test('copies carry the original wall properties', () => {
    const session = new EditorSession();
    const host = addWall(session, point(0, 0), point(4, 0), { height: 2.4 });
    addWall(session, point(2, 0), point(2, 3));

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    const copy = session.doc.get(result.created[0]) as WallEntity;
    const original = session.doc.get(host) as WallEntity;
    expect(copy.getHeight()).toBe(2.4);
    expect(copy.getThickness()).toBe(original.getThickness());
    // a copy is a new thing, so it gets its own mark
    expect(copy.mark).not.toBe(original.mark);
  });

  test('a window follows the piece it sits on, with t remapped', () => {
    const session = new EditorSession();
    const host = addWall(session, point(0, 0), point(4, 0));
    // at t=0.75 → x=3, which lands on the SECOND piece (2..4)
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: host,
      t: 0.75,
      width: 0.8,
    });
    addWall(session, point(2, 0), point(2, 3));

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    const moved = session.doc.get(window) as WindowEntity;
    expect(moved).toBeInstanceOf(WindowEntity);
    // re-hosted onto the piece that actually contains it
    expect(session.doc.relations.dependentsOf(result.created[0])).toEqual([
      window,
    ]);
    expect(session.doc.relations.dependentsOf(host)).toEqual([]);
    // x=3 is the midpoint of the 2..4 piece
    expect(moved.t).toBeCloseTo(0.5, 6);
  });

  test('a window on the piece that keeps the id stays put', () => {
    const session = new EditorSession();
    const host = addWall(session, point(0, 0), point(4, 0));
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: host,
      t: 0.25, // x=1 → the first piece
      width: 0.8,
    });
    addWall(session, point(2, 0), point(2, 3));

    session.dispatch('WALL.RESOLVE', {});

    expect(session.doc.relations.dependentsOf(host)).toEqual([window]);
    expect((session.doc.get(window) as WindowEntity).t).toBeCloseTo(0.5, 6);
  });

  test('is idempotent — resolving twice changes nothing the second time', () => {
    const session = new EditorSession();
    addWall(session, point(0, 0), point(4, 0));
    addWall(session, point(2, -2), point(2, 2));

    session.dispatch('WALL.RESOLVE', {});
    const after = spans(session);
    const again = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(again).toEqual({ split: [], created: [], removed: [] });
    expect(spans(session)).toEqual(after);
  });

  test('room detection survives, with the same area', () => {
    const session = new EditorSession();
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    for (let i = 0; i < corners.length; i++) {
      addWall(session, corners[i], corners[(i + 1) % corners.length]);
    }
    const before = detectSpaces(session.doc, null)[0].netArea;

    session.dispatch('WALL.RESOLVE', {});

    const after = detectSpaces(session.doc, null);
    expect(after).toHaveLength(1);
    expect(after[0].netArea).toBeCloseTo(before, 6);
  });

  test('two rooms sharing a party wall keep both rooms', () => {
    const session = new EditorSession();
    // left room 0..4, right room 4..8, with ONE shared wall at x=4
    for (const [a, b] of [
      [point(0, 0), point(4, 0)],
      [point(4, 0), point(8, 0)],
      [point(8, 0), point(8, 4)],
      [point(8, 4), point(4, 4)],
      [point(4, 4), point(0, 4)],
      [point(0, 4), point(0, 0)],
      [point(4, 0), point(4, 4)],
    ] as const) {
      addWall(session, a, b);
    }

    session.dispatch('WALL.RESOLVE', {});

    expect(detectSpaces(session.doc, null)).toHaveLength(2);
  });

  test('is one undo', () => {
    const session = new EditorSession();
    addWall(session, point(0, 0), point(4, 0));
    addWall(session, point(2, -2), point(2, 2));
    const before = spans(session);

    session.dispatch('WALL.RESOLVE', {});
    expect(walls(session)).toHaveLength(4);

    session.undo();
    expect(spans(session)).toEqual(before);
  });

  test('protects a locked wall while still splitting the new one', () => {
    const session = new EditorSession();
    const layer = session.dispatch<LayerId>('LAYER.ADD', { name: 'original' });
    const original = addWall(session, point(0, 0), point(4, 0), {
      layerId: layer,
    });
    session.dispatch('LAYER.UPDATE', { id: layer, locked: true });
    const drawn = addWall(session, point(2, -2), point(2, 2));

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(result.split).toEqual([drawn]);
    expect(result.created).toHaveLength(1);
    expect(result.removed).toEqual([]);
    expect((session.doc.get(original) as WallEntity).getBaseline()).toEqual({
      a: point(0, 0),
      b: point(4, 0),
    });
    expect(spans(session)).toEqual(['0,0→4,0', '2,-2→2,0', '2,0→2,2']);
  });

  test('the same crossing splits both walls once the layer is unlocked', () => {
    const session = new EditorSession();
    const layer = session.dispatch<LayerId>('LAYER.ADD', { name: 'original' });
    addWall(session, point(0, 0), point(4, 0), { layerId: layer });
    addWall(session, point(2, -2), point(2, 2));

    session.dispatch('WALL.RESOLVE', {});

    expect(spans(session)).toEqual([
      '0,0→2,0',
      '2,-2→2,0',
      '2,0→2,2',
      '2,0→4,0',
    ]);
  });

  test('a wall drawn over a locked one is the duplicate that goes', () => {
    const session = new EditorSession();
    const drawn = addWall(session, point(0, 0), point(4, 0));
    // added SECOND, so document order would hand the run to the other one
    const layer = session.dispatch<LayerId>('LAYER.ADD', { name: 'original' });
    const original = addWall(session, point(0, 0), point(4, 0), {
      layerId: layer,
    });
    session.dispatch('LAYER.UPDATE', { id: layer, locked: true });

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(result.removed).toEqual([drawn]);
    expect(walls(session)).toHaveLength(1);
    expect(session.doc.get(original)).not.toBeNull();
  });

  test('a locked wall keeps its window where it was', () => {
    const session = new EditorSession();
    const layer = session.dispatch<LayerId>('LAYER.ADD', { name: 'original' });
    const original = addWall(session, point(0, 0), point(4, 0), {
      layerId: layer,
    });
    const window = session.dispatch<EntityId>('WINDOW.ADD', {
      wallId: original,
      t: 0.75, // x=3, the far side of the cut a resolve would otherwise make
      width: 0.8,
    });
    session.dispatch('LAYER.UPDATE', { id: layer, locked: true });
    addWall(session, point(2, 0), point(2, 3));

    session.dispatch('WALL.RESOLVE', {});

    expect(session.doc.relations.dependentsOf(original)).toEqual([window]);
    expect((session.doc.get(window) as WindowEntity).t).toBeCloseTo(0.75, 6);
  });

  test('two locked walls overlapping each other are left alone', () => {
    const session = new EditorSession();
    const layer = session.dispatch<LayerId>('LAYER.ADD', { name: 'original' });
    addWall(session, point(0, 0), point(6, 0), { layerId: layer });
    addWall(session, point(4, 0), point(10, 0), { layerId: layer });
    session.dispatch('LAYER.UPDATE', { id: layer, locked: true });
    const before = spans(session);

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(result).toEqual({ split: [], created: [], removed: [] });
    expect(spans(session)).toEqual(before);
  });

  test('scopes to a level when asked', () => {
    const session = new EditorSession();
    const level = session.dispatch<string>('LEVEL.ADD', {
      name: 'L1',
      elevation: 0,
    });
    addWall(session, point(0, 0), point(4, 0));
    addWall(session, point(2, 0), point(2, 3), { levelId: level });

    // the ground-floor walls are level-unassigned, so a level-scoped resolve
    // still sees them (they appear on every level, as plan views query)
    const result = session.dispatch<Result>('WALL.RESOLVE', { levelId: level });
    expect(result.split).toHaveLength(1);
  });

  test('a wall on a hidden layer takes no part at all', () => {
    const session = new EditorSession();
    const layer = session.dispatch<LayerId>('LAYER.ADD', {
      name: 'hidden work',
    });
    const buried = addWall(session, point(2, -2), point(2, 2), {
      layerId: layer,
    });
    session.dispatch('LAYER.UPDATE', { id: layer, visible: false });
    const crossing = addWall(session, point(0, 0), point(4, 0));

    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    // being cut by something you cannot see is the worst outcome of the three
    expect(result).toEqual({ split: [], created: [], removed: [] });
    expect((session.doc.get(crossing) as WallEntity).getBaseline()).toEqual({
      a: point(0, 0),
      b: point(4, 0),
    });
    expect((session.doc.get(buried) as WallEntity).getBaseline()).toEqual({
      a: point(2, -2),
      b: point(2, 2),
    });
  });

  test('the same wall revealed again does split the crosser', () => {
    const session = new EditorSession();
    const layer = session.dispatch<LayerId>('LAYER.ADD', { name: 'work' });
    addWall(session, point(2, -2), point(2, 2), { layerId: layer });
    session.dispatch('LAYER.UPDATE', { id: layer, visible: false });
    addWall(session, point(0, 0), point(4, 0));
    session.dispatch('WALL.RESOLVE', {});

    // show it, and it starts counting — hidden was the only reason it did not
    session.dispatch('LAYER.UPDATE', { id: layer, visible: true });
    const result = session.dispatch<Result>('WALL.RESOLVE', {});

    expect(result.split.length).toBeGreaterThan(0);
    expect(walls(session)).toHaveLength(4);
  });
});
