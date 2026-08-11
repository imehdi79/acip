import type { EditorSession } from '@acip/editor-core';
import { DoorEntity } from '@acip/editor-core';

/** the two things that decide how a door hangs */
export interface DoorHang {
  /** which face of the wall the leaf opens onto */
  readonly swing: 1 | -1;
  /** which jamb it is hinged on */
  readonly hinge: 1 | -1;
}

/**
 * The four ways a door can hang, in an order where each step changes exactly
 * ONE of the two.
 *
 * A door has two independent choices and the user asked for one button, so the
 * button has to walk them. Flipping both at once would jump the leaf across the
 * opening and read as a glitch; changing one at a time means every press is a
 * single visible movement — the swing flips, then the hinge moves, then the
 * swing flips back — and four presses come home.
 */
const CYCLE: readonly DoorHang[] = [
  { hinge: -1, swing: 1 },
  { hinge: -1, swing: -1 },
  { hinge: 1, swing: -1 },
  { hinge: 1, swing: 1 },
];

/** the next way to hang this door; anything unrecognised starts the cycle */
export function nextDoorHang(current: DoorHang): DoorHang {
  const at = CYCLE.findIndex(
    (hang) => hang.swing === current.swing && hang.hinge === current.hinge,
  );
  return CYCLE[(at + 1) % CYCLE.length];
}

/** the selected doors, in selection order */
export function selectedDoors(session: EditorSession): DoorEntity[] {
  const doors: DoorEntity[] = [];
  for (const id of session.selection.list()) {
    const entity = session.doc.get(id);
    if (entity instanceof DoorEntity) doors.push(entity);
  }
  return doors;
}

/**
 * Rehang every selected door one step round the cycle.
 *
 * The step is taken from the FIRST door and applied to all of them, so a
 * selection that started out mixed ends up agreeing rather than each door
 * marching to its own rhythm — with several selected, "the same again" is the
 * only thing the next press can sensibly mean.
 */
export function cycleDoorHang(session: EditorSession): void {
  const doors = selectedDoors(session);
  if (doors.length === 0) return;
  const next = nextDoorHang(doors[0]);
  session.dispatch('DOOR.SETHANG', {
    ids: doors.map((door) => door.id),
    swing: next.swing,
    hinge: next.hinge,
  });
}
