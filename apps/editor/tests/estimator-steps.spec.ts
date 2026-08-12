import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, SpaceTagEntity, point } from '@acip/editor-core';
import type { EntityId, LayerId, LevelId } from '@acip/editor-core';
import {
  estimatorSteps,
  type EstimatorStep,
} from '@/app/components/layout/footer/estimator-steps';

/**
 * What the estimator wizard walks, without React: the list is one pure
 * function over the document, so "which shapes, in what order, called what"
 * is testable from a session alone (the resolveFooter pattern).
 */

let session: EditorSession;

const addWall = (
  ax: number,
  ay: number,
  bx: number,
  by: number,
  extra: Record<string, unknown> = {},
): EntityId =>
  session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
    thickness: 0.3,
    height: 3,
    ...extra,
  });

/** 6×4 room of 0.3 m walls — net 5.7 × 3.7 = 21.1 m² */
const drawRoom = (extra: Record<string, unknown> = {}): EntityId[] => [
  addWall(0, 0, 6, 0, extra),
  addWall(6, 0, 6, 4, extra),
  addWall(6, 4, 0, 4, extra),
  addWall(0, 4, 0, 0, extra),
];

const names = (levelId: LevelId | null = null): string[] =>
  estimatorSteps(session.doc, levelId).map((step) => step.name);

beforeEach(() => {
  session = new EditorSession();
});

describe('estimatorSteps', () => {
  it('has nothing to walk on an empty plan', () => {
    expect(estimatorSteps(session.doc, null)).toEqual([]);
  });

  // structure first, then what it encloses, then what is cut into it — the
  // order someone reads a plan in, and the order the marks are numbered in
  it('walks the walls, then their rooms, then the openings', () => {
    const walls = drawRoom();
    session.dispatch('DOOR.ADD', { wallId: walls[0], t: 0.5, width: 0.9 });
    session.dispatch('WINDOW.ADD', { wallId: walls[2], t: 0.5 });

    expect(names()).toEqual([
      'Wall W1',
      'Wall W2',
      'Wall W3',
      'Wall W4',
      'Room 21.1 m²',
      'Door D1',
      'Window WN1',
    ]);
  });

  it('gives every step an identity of its own', () => {
    drawRoom();
    const ids = estimatorSteps(session.doc, null).map((step) => step.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('reports the same sequence twice for the same document', () => {
    const walls = drawRoom();
    session.dispatch('WINDOW.ADD', { wallId: walls[1], t: 0.4 });
    session.dispatch('STAIR.ADD', { origin: point(2, 1), height: 3 });

    expect(estimatorSteps(session.doc, null)).toEqual(
      estimatorSteps(session.doc, null),
    );
  });

  it('names a room by its tag, and never steps through the tag itself', () => {
    drawRoom();
    const space = estimatorSteps(session.doc, null).find(
      (step) => step.kind === 'room',
    );
    expect(space?.name).toBe('Room 21.1 m²');

    session.dispatch('SPACE.SETNAME', { at: point(3, 2), name: 'Kitchen' });

    // the tag stores the NAME, it is not a shape: one step more would be it
    expect(names()).toEqual([
      'Wall W1',
      'Wall W2',
      'Wall W3',
      'Wall W4',
      'Room — Kitchen',
    ]);
  });

  it('reads a room no name the plan does not carry', () => {
    // a name is a tag entity on a layer of its own, so it can be hidden while
    // the room it names stays on the drawing. The canvas drops the name and
    // keeps the area; the wizard has to say the same thing, or the walk-through
    // and the plan disagree about what a room is called.
    const plan = session.dispatch<LayerId>('LAYER.ADD', { name: 'plan' });
    drawRoom({ layerId: plan });
    session.dispatch('SPACE.SETNAME', { at: point(3, 2), name: 'Kitchen' });
    const tag = session.doc
      .all()
      .find((e): e is SpaceTagEntity => e instanceof SpaceTagEntity)!;
    expect(names()).toContain('Room — Kitchen');

    session.dispatch('LAYER.UPDATE', { id: tag.layerId, visible: false });
    expect(names()).toContain('Room 21.1 m²');
  });

  it('skips whatever a hidden layer hides', () => {
    drawRoom();
    const buried = session.dispatch<LayerId>('LAYER.ADD', { name: 'buried' });
    addWall(10, 0, 12, 0, { layerId: buried });
    expect(names()).toContain('Wall W5');

    session.dispatch('LAYER.UPDATE', { id: buried, visible: false });
    expect(names()).not.toContain('Wall W5');
  });

  // nothing enumerates entity types: membership is "what is in the document",
  // so a type the wizard has never heard of still gets its own step
  it('carries an unfamiliar type through as a step of its own', () => {
    drawRoom();
    session.dispatch('STAIR.ADD', { origin: point(2, 1), height: 3 });
    session.dispatch('LINE.ADD', { a: point(8, 0), b: point(9, 0) });

    // a type in the plan's mark table reads as the plan draws it; one without
    // still names itself rather than dropping out of the walk
    expect(names().slice(-2)).toEqual(['Line 1', 'Stair ST1']);
  });

  // the wizard sends the camera to step.bounds, so a step that names a shape
  // and points somewhere else is worse than not moving the camera at all
  describe('says where each shape is', () => {
    /** the one step this matches — every shape in the walk is there once */
    const stepFor = (
      match: (step: EstimatorStep) => boolean,
    ): EstimatorStep => {
      const found = estimatorSteps(session.doc, null).find(match);
      if (!found) throw new Error('no step matched');
      return found;
    };

    it('covers the wall it names', () => {
      drawRoom();
      const wall = stepFor((step) => step.name === 'Wall W1');

      // W1 runs (0,0)→(6,0), 0.3 thick: the box holds the whole run and is a
      // wall's worth of thickness deep, not a room's worth
      expect(wall.bounds.minX).toBeLessThanOrEqual(0);
      expect(wall.bounds.maxX).toBeGreaterThanOrEqual(6);
      expect(wall.bounds.maxX - wall.bounds.minX).toBeLessThan(7);
      expect(wall.bounds.minY).toBeGreaterThanOrEqual(-1);
      expect(wall.bounds.maxY).toBeLessThanOrEqual(1);
    });

    it('covers the room it names, walls included', () => {
      drawRoom();
      const room = stepFor((step) => step.kind === 'room');

      // a room is derived, so this comes from its loop: the gross one, which
      // reaches the wall centerlines of the 6×4 box
      expect(room.bounds).toEqual({ minX: 0, minY: 0, maxX: 6, maxY: 4 });
    });

    it('puts an opening where its wall is, not where its wall starts', () => {
      const walls = drawRoom();
      session.dispatch('DOOR.ADD', { wallId: walls[0], t: 0.5, width: 0.9 });
      const door = stepFor((step) => step.kind === 'door');

      // the leaf and its swing sit around the halfway point of (0,0)→(6,0):
      // the box holds x=3 and is nothing like the length of the host wall
      expect(door.bounds.minX).toBeLessThanOrEqual(3);
      expect(door.bounds.maxX).toBeGreaterThanOrEqual(3);
      expect(door.bounds.maxX - door.bounds.minX).toBeLessThan(3);
    });

    it('gives every step a box the camera can actually use', () => {
      const walls = drawRoom();
      session.dispatch('WINDOW.ADD', { wallId: walls[1], t: 0.4 });
      session.dispatch('STAIR.ADD', { origin: point(2, 1), height: 3 });

      for (const step of estimatorSteps(session.doc, null)) {
        const { minX, minY, maxX, maxY } = step.bounds;
        // an infinite or inverted box is what an empty geometry produces, and
        // it would send the camera to NaN rather than to the shape
        for (const n of [minX, minY, maxX, maxY])
          expect(Number.isFinite(n)).toBe(true);
        expect(maxX).toBeGreaterThanOrEqual(minX);
        expect(maxY).toBeGreaterThanOrEqual(minY);
      }
    });

    it('reports the same box twice for the same document', () => {
      drawRoom();
      // deterministic down to the geometry: the walk is re-derived every time
      // the wizard opens, and the camera must not drift between openings
      expect(estimatorSteps(session.doc, null).map((s) => s.bounds)).toEqual(
        estimatorSteps(session.doc, null).map((s) => s.bounds),
      );
    });
  });

  /*
   * Framing a stretch of plan says "somewhere around here"; the selection
   * colour says "this one". On a wall in a row of identical walls, the second
   * is the whole answer — so every step has to know what to light up.
   */
  describe('says what to light up', () => {
    it('points an entity step at itself', () => {
      const walls = drawRoom();
      const first = estimatorSteps(session.doc, null)[0];
      expect(first.entityIds).toEqual([walls[0]]);
    });

    it('points a room at the walls that bound it', () => {
      const walls = drawRoom();
      const room = estimatorSteps(session.doc, null).find(
        (step) => step.kind === 'room',
      );
      // a room is derived: there is no room to select, only its sides
      expect([...(room?.entityIds ?? [])].sort()).toEqual([...walls].sort());
    });

    it('never points at something that is not in the document', () => {
      const walls = drawRoom();
      session.dispatch('DOOR.ADD', { wallId: walls[0], t: 0.5, width: 0.9 });
      for (const step of estimatorSteps(session.doc, null)) {
        expect(step.entityIds.length).toBeGreaterThan(0);
        for (const id of step.entityIds) {
          expect(session.doc.get(id)).toBeTruthy();
        }
      }
    });
  });

  it('walks one level at a time, and the unassigned shapes on all of them', () => {
    const l1 = session.dispatch<LevelId>('LEVEL.ADD', {
      name: 'L1',
      elevation: 0,
    });
    const l2 = session.dispatch<LevelId>('LEVEL.ADD', {
      name: 'L2',
      elevation: 3,
    });
    drawRoom({ levelId: l1 });
    addWall(10, 0, 12, 0); // level-unassigned: present on every level

    expect(names(l1)).toEqual([
      'Wall W1',
      'Wall W2',
      'Wall W3',
      'Wall W4',
      'Wall W5',
      'Room 21.1 m²',
    ]);
    expect(names(l2)).toEqual(['Wall W5']);
  });
});
