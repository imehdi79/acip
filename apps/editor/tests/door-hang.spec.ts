import { beforeEach, describe, expect, it } from 'vitest';
import { DoorEntity, EditorSession, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import {
  cycleDoorHang,
  nextDoorHang,
  selectedDoors,
} from '@/app/components/layout/footer/door-hang';

/**
 * One button, four ways to hang a door. Each press must make exactly one
 * visible change, and four presses must come home.
 */

let session: EditorSession;
let wallId: EntityId;

const addDoor = (t = 0.5): EntityId =>
  session.dispatch<EntityId>('DOOR.ADD', { wallId, t, width: 0.9 });

const door = (id: EntityId) => session.doc.get(id) as DoorEntity;

const hangOf = (id: EntityId) => ({
  swing: door(id).swing,
  hinge: door(id).hinge,
});

beforeEach(() => {
  session = new EditorSession();
  wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(6, 0),
    thickness: 0.3,
  });
});

describe('nextDoorHang', () => {
  it('changes exactly one of the two on every step', () => {
    let hang = { swing: 1, hinge: -1 } as const as {
      swing: 1 | -1;
      hinge: 1 | -1;
    };
    for (let step = 0; step < 4; step++) {
      const next = nextDoorHang(hang);
      const changed =
        (next.swing !== hang.swing ? 1 : 0) +
        (next.hinge !== hang.hinge ? 1 : 0);
      expect(changed).toBe(1);
      hang = next;
    }
  });

  it('comes home after four steps', () => {
    const start = { swing: 1, hinge: -1 } as const;
    let hang: { swing: 1 | -1; hinge: 1 | -1 } = start;
    for (let step = 0; step < 4; step++) hang = nextDoorHang(hang);
    expect(hang).toEqual(start);
  });

  it('reaches all four combinations', () => {
    const seen = new Set<string>();
    let hang: { swing: 1 | -1; hinge: 1 | -1 } = { swing: 1, hinge: -1 };
    for (let step = 0; step < 4; step++) {
      seen.add(`${hang.swing}:${hang.hinge}`);
      hang = nextDoorHang(hang);
    }
    expect(seen.size).toBe(4);
  });
});

describe('cycleDoorHang', () => {
  it('rehangs the selected door', () => {
    const id = addDoor();
    session.selection.add(id);
    const before = hangOf(id);

    cycleDoorHang(session);

    expect(hangOf(id)).not.toEqual(before);
  });

  it('is one undo per press', () => {
    const id = addDoor();
    session.selection.add(id);
    const before = hangOf(id);

    cycleDoorHang(session);
    session.undo();

    expect(hangOf(id)).toEqual(before);
  });

  it('brings the door back after four presses', () => {
    const id = addDoor();
    session.selection.add(id);
    const before = hangOf(id);

    for (let press = 0; press < 4; press++) cycleDoorHang(session);

    expect(hangOf(id)).toEqual(before);
  });

  it('lands several selected doors on the same hang', () => {
    const first = addDoor(0.25);
    const second = addDoor(0.75);
    // start them disagreeing
    session.dispatch('DOOR.SETHANG', { ids: [second], swing: -1, hinge: 1 });
    session.selection.add(first);
    session.selection.add(second);

    cycleDoorHang(session);

    expect(hangOf(second)).toEqual(hangOf(first));
  });

  it('does nothing without a door selected', () => {
    const id = addDoor();
    session.selection.add(wallId);
    const before = hangOf(id);

    expect(() => cycleDoorHang(session)).not.toThrow();
    expect(hangOf(id)).toEqual(before);
  });

  it('picks the doors out of a mixed selection', () => {
    const id = addDoor();
    session.selection.add(wallId);
    session.selection.add(id);

    expect(selectedDoors(session).map((d) => d.id)).toEqual([id]);
  });
});

describe('the plan symbol follows the hang', () => {
  const tip = (id: EntityId) => {
    const geometry = door(id).getBaseGeometry();
    // the leaf is the segment; its far end is where the door stands open
    const leaf = (geometry as { children: unknown[] }).children[0] as {
      a: { x: number; y: number };
      b: { x: number; y: number };
    };
    return leaf;
  };

  it('hangs the leaf on the other jamb when the hinge moves', () => {
    const id = addDoor(0.5);
    const before = tip(id).a;

    session.dispatch('DOOR.SETHANG', { ids: [id], hinge: 1 });

    expect(tip(id).a.x).toBeGreaterThan(before.x);
  });

  it('swings the leaf to the other face when the swing flips', () => {
    const id = addDoor(0.5);
    const before = tip(id).b;

    session.dispatch('DOOR.SETHANG', { ids: [id], swing: -1 });

    expect(Math.sign(tip(id).b.y)).toBe(-Math.sign(before.y));
  });

  it('keeps the leaf a full door width however it hangs', () => {
    const id = addDoor(0.5);
    for (let press = 0; press < 4; press++) {
      cycleDoorHangOn(id);
      const leaf = tip(id);
      expect(Math.hypot(leaf.b.x - leaf.a.x, leaf.b.y - leaf.a.y)).toBeCloseTo(
        0.9,
        6,
      );
    }
  });

  const cycleDoorHangOn = (id: EntityId) => {
    session.selection.clear();
    session.selection.add(id);
    cycleDoorHang(session);
  };
});
