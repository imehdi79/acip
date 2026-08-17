import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  point,
  spaceName,
} from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { applyMeasurements } from '@/app/components/layout/footer/measurements';
import { planWallResize } from '@/editor/rooms';
import { wallExtent } from '@/editor/viewport/wall-dimensions';

/**
 * Resizing a wall from the footer is connection-aware. Connectivity is the
 * wall-join topology's own answer (getJoinsAt), never "is there a wall near
 * here", and it decides which end holds still:
 *
 *   ANCHOR SIDE  the joined end, untouched — that neighbour keeps its
 *                geometry and its measured length exactly.
 *   MOVING SIDE  the corner partner is carried rigidly, so it keeps its own
 *                size while the wall facing the subject grows by the delta.
 *
 * Net effect on a room: it gets wider without getting taller, and no corner
 * comes apart.
 */

let session: EditorSession;

const THICKNESS = 0.3;

const wall = (a: Point, b: Point): WallEntity => {
  const id = session.dispatch<EntityId>('WALL.ADD', {
    a,
    b,
    thickness: THICKNESS,
    height: 3,
  });
  return session.doc.get(id) as WallEntity;
};

/** 4 walls counter-clockwise: bottom, right, top, left */
function room(width: number, height: number) {
  const corners = [
    point(0, 0),
    point(width, 0),
    point(width, height),
    point(0, height),
  ];
  const [bottom, right, top, left] = corners.map((a, i) =>
    wall(a, corners[(i + 1) % corners.length]),
  );
  return { bottom, right, top, left };
}

/** the number the plan labels this wall with */
const shown = (w: WallEntity): number => wallExtent(w)!.length;

const centreline = (w: WallEntity): number => {
  const { a, b } = w.getBaseline();
  return Math.hypot(b.x - a.x, b.y - a.y);
};

const ends = (w: WallEntity) => w.getBaseline();

const setLength = (w: WallEntity, length: number) =>
  applyMeasurements(
    session,
    [w],
    { length: String(length), height: '', thickness: '' },
    // outside, matching `shown` above: this file is about which END moves, and
    // the inside/outside choice is about which FACE is measured — mixing the
    // two would only make every expected number a thickness harder to read
    { levelId: null, mode: 'outside' },
  );

beforeEach(() => {
  session = new EditorSession();
});

describe('which end moves', () => {
  it('holds the joined end when only the left is joined', () => {
    // ├── neighbour ──┤├── subject ──┤   (subject's 'a' is the shared corner)
    wall(point(-3, 0), point(0, 0));
    const subject = wall(point(0, 0), point(4, 0));

    const plan = planWallResize(session.doc, subject.id, 6)!;
    expect(plan.anchorIndex).toBe(0);

    setLength(subject, 6);
    expect(ends(subject).a).toEqual(point(0, 0));
    expect(ends(subject).b.x).toBeCloseTo(6);
  });

  it('holds the joined end when only the right is joined', () => {
    const subject = wall(point(0, 0), point(4, 0));
    wall(point(4, 0), point(7, 0));

    const plan = planWallResize(session.doc, subject.id, 6)!;
    expect(plan.anchorIndex).toBe(1);

    setLength(subject, 6);
    expect(ends(subject).b).toEqual(point(4, 0));
    expect(ends(subject).a.x).toBeCloseTo(-2);
  });

  it('gives the right end priority when both are joined', () => {
    const walls = room(6, 4);

    const plan = planWallResize(session.doc, walls.bottom.id, 8)!;
    // bottom runs (0,0) → (6,0), so its right end is grip 1 and grip 0 anchors
    expect(plan.anchorIndex).toBe(0);

    setLength(walls.bottom, shown(walls.bottom) + 2);
    expect(ends(walls.bottom).a).toEqual(point(0, 0));
    expect(ends(walls.bottom).b.x).toBeGreaterThan(6);
  });

  it('reads left/right off the plan, not off the draw direction', () => {
    // drawn right-to-left: 'a' is the RIGHT end, so 'b' must anchor
    const walls = room(6, 4);
    // top runs (6,4) → (0,4)
    expect(ends(walls.top).a).toEqual(point(6, 4));

    const plan = planWallResize(session.doc, walls.top.id, 8)!;
    expect(plan.anchorIndex).toBe(1);

    setLength(walls.top, shown(walls.top) + 2);
    // the left end (grip 1, at x=0) stayed; the right end moved out
    expect(ends(walls.top).b).toEqual(point(0, 4));
    expect(ends(walls.top).a.x).toBeGreaterThan(6);
  });

  it('grows a vertical wall from its top when both ends are joined', () => {
    const walls = room(6, 4);
    // left runs (0,4) → (0,0): vertical, so the higher end counts as "right"
    const plan = planWallResize(session.doc, walls.left.id, 6)!;
    expect(plan.anchorIndex).toBe(1);

    setLength(walls.left, shown(walls.left) + 2);
    expect(ends(walls.left).b).toEqual(point(0, 0));
    expect(ends(walls.left).a.y).toBeGreaterThan(4);
  });

  it('stays centred when neither end is joined', () => {
    const lone = wall(point(0, 0), point(4, 0));

    const plan = planWallResize(session.doc, lone.id, 6)!;
    expect(plan.anchorIndex).toBeNull();

    setLength(lone, 6);
    expect(ends(lone).a.x).toBeCloseTo(-1);
    expect(ends(lone).b.x).toBeCloseTo(5);
  });
});

describe('connected walls are left alone', () => {
  it('does not touch the neighbour it is anchored to', () => {
    const neighbour = wall(point(-3, 0), point(0, 0));
    const subject = wall(point(0, 0), point(4, 0));
    const before = { ...ends(neighbour), shown: shown(neighbour) };

    setLength(subject, 6);

    expect(ends(neighbour)).toEqual({ a: before.a, b: before.b });
    // the join survives, so its measured length is unchanged too
    expect(shown(neighbour)).toBeCloseTo(before.shown, 6);
  });

  it('never moves the anchor grip, whatever gets carried', () => {
    const walls = room(6, 4);
    const plan = planWallResize(session.doc, walls.bottom.id, 8)!;
    expect(
      plan.moves.some(
        (move) =>
          move.id === walls.bottom.id && move.index === plan.anchorIndex,
      ),
    ).toBe(false);
  });

  it('leaves the anchor-side wall exactly where it was', () => {
    const walls = room(6, 4);
    const before = { ...ends(walls.left) };

    setLength(walls.bottom, shown(walls.bottom) + 2);

    expect(ends(walls.left)).toEqual(before);
  });

  it('proximity is not connection: a wall passing near by is not joined', () => {
    // half a metre clear of the subject's end — near, but touching nothing
    const subject = wall(point(0, 0), point(4, 0));
    wall(point(4.5, -2), point(4.5, 2));

    expect(subject.getJoinsAt('end')).toEqual([]);
    expect(planWallResize(session.doc, subject.id, 6)!.anchorIndex).toBeNull();
  });

  it('but a wall whose BODY covers the end is genuinely joined', () => {
    // centred 5 cm away, a 30 cm wall spans 3.90–4.20: the end is inside it
    const subject = wall(point(0, 0), point(4, 0));
    wall(point(4.05, -2), point(4.05, 2));

    expect(subject.getJoinsAt('end')[0].kind).toBe('tee');
    expect(planWallResize(session.doc, subject.id, 6)!.anchorIndex).toBe(1);
  });

  it('counts a tee as a connection', () => {
    // the subject's right end lands on the middle of a continuous wall
    const subject = wall(point(0, 0), point(4, 0));
    wall(point(4, -2), point(4, 2));

    expect(subject.getJoinsAt('end')[0].kind).toBe('tee');
    expect(planWallResize(session.doc, subject.id, 6)!.anchorIndex).toBe(1);
  });
});

describe('the moving end carries its corner', () => {
  it('translates the cross wall instead of skewing it', () => {
    const walls = room(6, 4);
    const before = centreline(walls.right);

    setLength(walls.bottom, shown(walls.bottom) + 2);

    // moved bodily to the new corner, same length, still vertical
    expect(ends(walls.right).a).toEqual(point(8, 0));
    expect(ends(walls.right).b).toEqual(point(8, 4));
    expect(centreline(walls.right)).toBeCloseTo(before, 6);
  });

  it('grows the facing wall by the same delta', () => {
    const walls = room(6, 4);
    const before = shown(walls.top);

    setLength(walls.bottom, shown(walls.bottom) + 0.85);

    expect(shown(walls.top)).toBeCloseTo(before + 0.85, 3);
  });

  it('shrinks the facing wall by the same delta', () => {
    const walls = room(6, 4);
    const before = shown(walls.top);

    setLength(walls.bottom, shown(walls.bottom) - 0.65);

    expect(shown(walls.top)).toBeCloseTo(before - 0.65, 3);
  });

  it('does not deform the other dimension', () => {
    const walls = room(6, 4);
    const across = [shown(walls.left), shown(walls.right)];

    setLength(walls.bottom, shown(walls.bottom) + 2);

    // the room got wider, not taller: both cross walls keep their size
    expect([shown(walls.left), shown(walls.right)]).toEqual(across);
  });

  it('holds the other dimension when resizing a vertical wall too', () => {
    const walls = room(6, 4);
    const along = [shown(walls.bottom), shown(walls.top)];
    const facing = shown(walls.left);

    setLength(walls.right, shown(walls.right) + 1.5);

    // taller, not wider: the horizontal pair is untouched, the facing
    // vertical wall takes the delta
    expect([shown(walls.bottom), shown(walls.top)]).toEqual(along);
    expect(shown(walls.left)).toBeCloseTo(facing + 1.5, 3);
  });
});

describe('the room after a resize', () => {
  it('stays closed when a wall grows, with the area it grew to', () => {
    const walls = room(6, 4);
    setLength(walls.bottom, shown(walls.bottom) + 2);

    const spaces = detectSpaces(session.doc, null);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].boundaryWallIds).toHaveLength(4);
    // net area is measured to the inner faces: (8 - 0.3) × (4 - 0.3)
    expect(spaces[0].netArea).toBeCloseTo(7.7 * 3.7, 2);
  });

  it('stays closed when a wall shrinks', () => {
    const walls = room(6, 4);
    setLength(walls.bottom, shown(walls.bottom) - 1.5);

    const spaces = detectSpaces(session.doc, null);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].netArea).toBeCloseTo(4.2 * 3.7, 2);
  });

  it('keeps every corner a real join, not an overshoot', () => {
    const walls = room(6, 4);
    setLength(walls.bottom, shown(walls.bottom) + 2);

    for (const w of [walls.bottom, walls.right, walls.top, walls.left]) {
      expect(w.getJoinsAt('start')[0]?.kind).toBe('corner');
      expect(w.getJoinsAt('end')[0]?.kind).toBe('corner');
    }
  });

  it('keeps a named room named', () => {
    const walls = room(6, 4);
    const space = detectSpaces(session.doc, null)[0];
    session.dispatch('SPACE.SETNAME', {
      at: space.labelPoint,
      name: 'Kitchen',
    });

    setLength(walls.bottom, shown(walls.bottom) + 2);

    const after = detectSpaces(session.doc, null);
    expect(after).toHaveLength(1);
    expect(spaceName(session.doc, after[0])).toBe('Kitchen');
  });
});

describe('the dialog and the plan agree', () => {
  it('carries the typed delta to the centreline, not the raw number', () => {
    const walls = room(6, 4);
    // 6 m centreline draws 6.30 with both corners mitered
    expect(shown(walls.bottom)).toBeCloseTo(6.3, 6);

    setLength(walls.bottom, 8);

    // 6.30 → 8.00 is +1.70, so the centreline goes 6 → 7.70
    expect(centreline(walls.bottom)).toBeCloseTo(7.7, 3);
  });

  it('rejects a length that would be nothing but corner miters', () => {
    const walls = room(6, 4);
    expect(setLength(walls.bottom, 0.2)).toEqual(['length']);
    expect(shown(walls.bottom)).toBeCloseTo(6.3, 3);
  });

  it('is one undo', () => {
    const walls = room(6, 4);
    const before = centreline(walls.bottom);

    setLength(walls.bottom, shown(walls.bottom) + 2);
    session.undo();

    expect(centreline(walls.bottom)).toBeCloseTo(before, 6);
  });
});
