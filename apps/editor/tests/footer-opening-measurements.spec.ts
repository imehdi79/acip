import { beforeEach, describe, expect, it } from 'vitest';
import {
  DoorEntity,
  EditorSession,
  WindowEntity,
  point,
} from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import {
  commonValue,
  prefill,
} from '@/app/components/layout/footer/measurements';
import {
  applyOpeningMeasurements,
  hasSill,
  selectedOpenings,
} from '@/app/components/layout/footer/opening-measurements';

/**
 * The opening Measurements dialog's whole decision, without React: which
 * fields are usable, what they dispatch, and what a bad field does to the
 * rest.
 */

let session: EditorSession;
let wallId: EntityId;

const addWindow = (t = 0.25) =>
  session.doc.get(
    session.dispatch<EntityId>('WINDOW.ADD', { wallId, t }),
  ) as WindowEntity;

const addDoor = (t = 0.75) =>
  session.doc.get(
    session.dispatch<EntityId>('DOOR.ADD', { wallId, t }),
  ) as DoorEntity;

const edits = (patch: Partial<Record<string, string>> = {}) => ({
  width: '',
  height: '',
  sill: '',
  thickness: '',
  ...patch,
});

beforeEach(() => {
  session = new EditorSession();
  wallId = session.dispatch<EntityId>('WALL.ADD', {
    a: point(0, 0),
    b: point(10, 0),
    thickness: 0.3,
    height: 3,
  });
});

describe('applyOpeningMeasurements', () => {
  it('sets every field of a window at once', () => {
    const win = addWindow();

    expect(
      applyOpeningMeasurements(
        session,
        [win],
        edits({
          width: '1.6',
          height: '1.4',
          sill: '1.1',
          thickness: '0.08',
        }),
      ),
    ).toEqual([]);

    expect(win.width).toBeCloseTo(1.6);
    expect(win.height).toBeCloseTo(1.4);
    expect(win.sill).toBeCloseTo(1.1);
    expect(win.thickness).toBeCloseTo(0.08);
  });

  it('leaves blank fields alone', () => {
    const win = addWindow();

    applyOpeningMeasurements(session, [win], edits({ height: '1.4' }));

    expect(win.width).toBeCloseTo(1.0);
    expect(win.sill).toBeCloseTo(0.9);
    expect(win.thickness).toBeCloseTo(0.05);
  });

  it('applies to every selected opening', () => {
    const openings = [addWindow(0.2), addWindow(0.6)];

    applyOpeningMeasurements(session, openings, edits({ width: '1.6' }));

    for (const opening of openings) expect(opening.width).toBeCloseTo(1.6);
  });

  it('applies the whole edit as one undo', () => {
    const win = addWindow();

    applyOpeningMeasurements(
      session,
      [win],
      edits({ width: '1.6', height: '1.4', sill: '1.1' }),
    );
    session.undo();

    expect(win.width).toBeCloseTo(1.0);
    expect(win.height).toBeCloseTo(1.2);
    expect(win.sill).toBeCloseTo(0.9);
  });

  it('reports bad fields and changes nothing at all', () => {
    const win = addWindow();

    const bad = applyOpeningMeasurements(
      session,
      [win],
      edits({ width: '1.6', height: 'tall' }),
    );

    expect(bad).toEqual(['height']);
    // the good field must not land on its own — the dialog stays open
    expect(win.width).toBeCloseTo(1.0);
  });

  it('reports bad fields in field order', () => {
    const win = addWindow();
    expect(
      applyOpeningMeasurements(
        session,
        [win],
        edits({ thickness: 'thick', width: 'wide' }),
      ),
    ).toEqual(['width', 'thickness']);
  });

  it('treats zero and negative sizes as bad input', () => {
    const win = addWindow();
    expect(
      applyOpeningMeasurements(session, [win], edits({ width: '0' })),
    ).toEqual(['width']);
    expect(
      applyOpeningMeasurements(session, [win], edits({ thickness: '-0.1' })),
    ).toEqual(['thickness']);
  });

  // a sill is a height above the floor, not a size: sitting ON the floor is a
  // real answer, dangling below it is not
  it('accepts a zero sill and rejects a negative one', () => {
    const win = addWindow();

    expect(
      applyOpeningMeasurements(session, [win], edits({ sill: '0' })),
    ).toEqual([]);
    expect(win.sill).toBe(0);

    expect(
      applyOpeningMeasurements(session, [win], edits({ sill: '-0.2' })),
    ).toEqual(['sill']);
  });

  it('accepts a unit suffix, overriding the display unit', () => {
    const win = addWindow();

    applyOpeningMeasurements(
      session,
      [win],
      edits({ width: '1600 mm', sill: '90cm' }),
    );

    expect(win.width).toBeCloseTo(1.6);
    expect(win.sill).toBeCloseTo(0.9);
  });

  it('drops a sill typed for a door instead of failing the whole edit', () => {
    const door = addDoor();

    // the dialog hides the field for a door, but a stale value must not take
    // the width down with it
    expect(
      applyOpeningMeasurements(
        session,
        [door],
        edits({ width: '1.1', sill: '1.1' }),
      ),
    ).toEqual([]);
    expect(door.width).toBeCloseTo(1.1);
    expect(door.getSillHeight()).toBe(0);
  });

  it('dispatches nothing when every field is blank', () => {
    const win = addWindow();
    const before = session.history.canUndo;

    expect(applyOpeningMeasurements(session, [win], edits())).toEqual([]);
    expect(session.history.canUndo).toBe(before);
  });
});

describe('prefilling the opening dialog', () => {
  it('offers a sill for windows only', () => {
    const win = addWindow();
    const door = addDoor();

    expect(hasSill([win])).toBe(true);
    expect(hasSill([door])).toBe(false);
    expect(hasSill([win, door])).toBe(false);
    expect(hasSill([])).toBe(false);
  });

  it('shows a shared value and blanks a mixed one', () => {
    const openings = [addWindow(0.2), addWindow(0.6)];
    expect(prefill(commonValue(openings, (o) => o.width))).toBe('1.00');

    applyOpeningMeasurements(session, [openings[0]], edits({ width: '1.6' }));
    expect(commonValue(openings, (o) => o.width)).toBeNull();
    expect(prefill(null)).toBe('');
  });

  it('collects only openings from the selection', () => {
    const win = addWindow();
    const door = addDoor();
    session.selection.add(wallId);
    session.selection.add(win.id);
    session.selection.add(door.id);

    expect(selectedOpenings(session).map((o) => o.id)).toEqual([
      win.id,
      door.id,
    ]);
  });
});
