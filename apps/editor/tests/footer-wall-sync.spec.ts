import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  point,
} from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { applyMeasurements } from '@/app/components/layout/footer/measurements';
import { wallExtent } from '@/editor/viewport/wall-dimensions';

/**
 * Editing one wall's length from the footer has to move the room, not just
 * that wall: the corners stay welded and the facing wall takes the same delta.
 * Everything here goes through the real footer entry point.
 */

let session: EditorSession;

const THICKNESS = 0.3;

/** 4 walls counter-clockwise: bottom, right, top, left */
function room(width: number, height: number): Record<Side, WallEntity> {
  const corners = [
    point(0, 0),
    point(width, 0),
    point(width, height),
    point(0, height),
  ];
  const ids = corners.map((a, i) =>
    session.dispatch<EntityId>('WALL.ADD', {
      a,
      b: corners[(i + 1) % corners.length],
      thickness: THICKNESS,
      height: 3,
    }),
  );
  const [bottom, right, top, left] = ids.map(
    (id) => session.doc.get(id) as WallEntity,
  );
  return { bottom, right, top, left };
}

type Side = 'bottom' | 'right' | 'top' | 'left';

/** the number the plan labels this wall with */
const shown = (wall: WallEntity): number => wallExtent(wall)!.length;

const centreline = (wall: WallEntity): number => {
  const { a, b } = wall.getBaseline();
  return Math.hypot(b.x - a.x, b.y - a.y);
};

const setLength = (wall: WallEntity, length: number) =>
  applyMeasurements(session, [wall], {
    length: String(length),
    height: '',
    thickness: '',
  });

/** every endpoint is still shared with exactly one other wall */
function cornersAreWelded(walls: WallEntity[]): boolean {
  const ends = walls.flatMap((wall) => {
    const { a, b } = wall.getBaseline();
    return [a, b];
  });
  return ends.every(
    (p) =>
      ends.filter((q) => Math.hypot(q.x - p.x, q.y - p.y) < 1e-6).length === 2,
  );
}

beforeEach(() => {
  session = new EditorSession();
});

describe('editing one wall of a room', () => {
  it('grows the facing wall by the same delta (bottom, longer)', () => {
    const walls = room(6, 4);
    const before = shown(walls.top);

    setLength(walls.bottom, shown(walls.bottom) + 0.85);

    expect(shown(walls.bottom)).toBeCloseTo(6.3 + 0.85, 3);
    expect(shown(walls.top)).toBeCloseTo(before + 0.85, 3);
  });

  it('shrinks the facing wall by the same delta (bottom, shorter)', () => {
    const walls = room(6, 4);
    const before = shown(walls.top);

    setLength(walls.bottom, shown(walls.bottom) - 0.65);

    expect(shown(walls.top)).toBeCloseTo(before - 0.65, 3);
  });

  it('works the same way driven from the top wall', () => {
    const walls = room(6, 4);
    const before = shown(walls.bottom);

    setLength(walls.top, shown(walls.top) + 1.2);
    expect(shown(walls.bottom)).toBeCloseTo(before + 1.2, 3);

    setLength(walls.top, shown(walls.top) - 0.4);
    expect(shown(walls.bottom)).toBeCloseTo(before + 0.8, 3);
  });

  it('works on the left/right pair too', () => {
    const walls = room(6, 4);
    const beforeLeft = shown(walls.left);

    setLength(walls.right, shown(walls.right) + 0.5);
    expect(shown(walls.left)).toBeCloseTo(beforeLeft + 0.5, 3);

    const beforeRight = shown(walls.right);
    setLength(walls.left, shown(walls.left) - 0.75);
    expect(shown(walls.right)).toBeCloseTo(beforeRight - 0.75, 3);
  });

  it('leaves the perpendicular walls alone', () => {
    const walls = room(6, 4);
    const left = shown(walls.left);
    const right = shown(walls.right);

    setLength(walls.bottom, shown(walls.bottom) + 1);

    expect(shown(walls.left)).toBeCloseTo(left, 3);
    expect(shown(walls.right)).toBeCloseTo(right, 3);
  });

  it('keeps every corner welded', () => {
    const walls = room(6, 4);
    const all = [walls.bottom, walls.right, walls.top, walls.left];
    expect(cornersAreWelded(all)).toBe(true);

    setLength(walls.bottom, shown(walls.bottom) + 0.85);

    expect(cornersAreWelded(all)).toBe(true);
  });

  it('keeps the room detectable, with the area it grew to', () => {
    const walls = room(6, 4);
    setLength(walls.bottom, shown(walls.bottom) + 2);

    const spaces = detectSpaces(session.doc, null);
    expect(spaces).toHaveLength(1);
    expect(spaces[0].boundaryWallIds).toHaveLength(4);
    // net area is measured to the inner faces: (8 - 0.3) × (4 - 0.3)
    expect(spaces[0].netArea).toBeCloseTo(7.7 * 3.7, 2);
  });

  it('grows about the midpoint, so the room does not slide sideways', () => {
    const walls = room(6, 4);
    const mid = (wall: WallEntity) => {
      const { a, b } = wall.getBaseline();
      return (a.x + b.x) / 2;
    };
    const before = mid(walls.bottom);

    setLength(walls.bottom, shown(walls.bottom) + 1);

    expect(mid(walls.bottom)).toBeCloseTo(before, 6);
    expect(mid(walls.top)).toBeCloseTo(before, 6);
  });

  it('is one undo for the whole room', () => {
    const walls = room(6, 4);
    const before = shown(walls.bottom);

    setLength(walls.bottom, before + 0.85);
    session.undo();

    expect(shown(walls.bottom)).toBeCloseTo(before, 3);
    expect(shown(walls.top)).toBeCloseTo(before, 3);
  });

  it('applies a height edit and a length edit together, still one undo', () => {
    const walls = room(6, 4);
    const before = shown(walls.bottom);

    applyMeasurements(session, [walls.bottom], {
      length: String(before + 1),
      height: '2.4',
      thickness: '',
    });
    expect(walls.bottom.getHeight()).toBeCloseTo(2.4);
    expect(shown(walls.top)).toBeCloseTo(before + 1, 3);

    session.undo();
    expect(walls.bottom.getHeight()).toBeCloseTo(3);
    expect(shown(walls.bottom)).toBeCloseTo(before, 3);
  });
});

describe('the dialog and the plan agree', () => {
  it('prefills the wall with the length the plan labels it', () => {
    const walls = room(6, 4);
    // a mitered corner reaches past the endpoint: 6 m centreline draws 6.30
    expect(centreline(walls.bottom)).toBeCloseTo(6, 6);
    expect(shown(walls.bottom)).toBeCloseTo(6.3, 6);
  });

  it('carries the typed delta to the centreline, not the raw number', () => {
    const walls = room(6, 4);

    setLength(walls.bottom, 8);

    // 6.30 → 8.00 is +1.70, so the centreline goes 6 → 7.70
    expect(centreline(walls.bottom)).toBeCloseTo(7.7, 3);
    expect(shown(walls.bottom)).toBeCloseTo(8, 3);
  });

  it('rejects a length that would be nothing but corner miters', () => {
    const walls = room(6, 4);
    expect(setLength(walls.bottom, 0.2)).toEqual(['length']);
    expect(shown(walls.bottom)).toBeCloseTo(6.3, 3);
  });
});

describe('a wall that is not part of a room', () => {
  it('still stretches on its own, as before', () => {
    const id = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(4, 0),
      thickness: THICKNESS,
    });
    const wall = session.doc.get(id) as WallEntity;
    // free-standing walls have butt caps, so extent === centreline
    expect(shown(wall)).toBeCloseTo(4, 6);

    setLength(wall, 6);

    expect(centreline(wall)).toBeCloseTo(6, 6);
    // symmetric about the midpoint
    expect(wall.getBaseline().a.x).toBeCloseTo(-1, 6);
    expect(wall.getBaseline().b.x).toBeCloseTo(5, 6);
  });
});
