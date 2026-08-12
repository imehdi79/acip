import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity, point } from '@acip/editor-core';
import type { EntityId, LayerId, Point } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { enterDangerZone } from '@/editor/danger-zone';
import { PEN_TOOL } from '@/app/components/layout/footer/pen';

/**
 * Free draw: ink in, walls out, at the moment the finger lifts. The stroke is
 * a real one — a wobbling hand sampled every few centimetres — because a
 * straight two-point drag would test nothing that the wall tool does not
 * already cover.
 */

const NO_MODS = { shift: false, ctrl: false, alt: false };

let session: EditorSession;
let runtime: EditorRuntime;

const walls = (): WallEntity[] =>
  session.doc.all().filter((e): e is WallEntity => e instanceof WallEntity);

/** drag a stroke through these points, wobbling as a hand does */
const draw = (...via: Point[]) => {
  const wobble = (p: Point, i: number): Point => ({
    x: p.x + (i % 2 ? 0.02 : -0.02),
    y: p.y + (i % 3 ? -0.015 : 0.015),
  });
  const path: Point[] = [];
  for (let leg = 1; leg < via.length; leg++) {
    const from = via[leg - 1];
    const to = via[leg];
    const steps = 12;
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      path.push(
        wobble(
          { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t },
          s,
        ),
      );
    }
  }
  runtime.tools.pointerDown({
    point: path[0],
    modifiers: NO_MODS,
    snapped: false,
  });
  for (const p of path.slice(1))
    runtime.tools.pointerMove({ point: p, modifiers: NO_MODS, snapped: false });
  runtime.tools.pointerUp({
    point: path[path.length - 1],
    modifiers: NO_MODS,
    snapped: false,
  });
};

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
  runtime.tools.worldTolerance = 0.2;
  runtime.tools.useById(PEN_TOOL);
});

describe('the pen', () => {
  it('is a registered tool the footer button can arm', () => {
    expect(runtime.ui.activeToolId.get()).toBe(PEN_TOOL);
  });

  it('builds a wall the moment the stroke ends', () => {
    expect(walls()).toHaveLength(0);
    draw(point(0, 0), point(5, 0));

    expect(walls()).toHaveLength(1);
    // there is nothing left over to convert: the ink is gone and the wall IS
    // the drawing, so undo means what it always means
    expect(runtime.ui.overlay.get().ink).toBeNull();
  });

  it('straightens a hand-drawn line rather than tracing the wobble', () => {
    draw(point(0, 0), point(5, 0));
    const { a, b } = walls()[0].getBaseline();

    // drawn roughly along x, so it comes back exactly along x
    expect(a.y).toBeCloseTo(b.y, 6);
    expect(Math.abs(b.x - a.x)).toBeGreaterThan(4.5);
  });

  it('turns one stroke with a corner into two walls that meet', () => {
    draw(point(0, 0), point(5, 0), point(5, 4));

    expect(walls()).toHaveLength(2);
    // welded, not merely near: a join is the derived answer to "is this end
    // connected", and it is what makes the corner miter instead of gape
    for (const wall of walls()) {
      const joins =
        wall.getJoinsAt('start').length + wall.getJoinsAt('end').length;
      expect(joins).toBeGreaterThan(0);
    }
    // and each leg kept its own axis rather than being averaged into a diagonal
    const [first, second] = walls().map((w) => w.getBaseline());
    const horizontal = [first, second].filter(
      (bl) => Math.abs(bl.a.y - bl.b.y) < 1e-6,
    );
    const vertical = [first, second].filter(
      (bl) => Math.abs(bl.a.x - bl.b.x) < 1e-6,
    );
    expect(horizontal).toHaveLength(1);
    expect(vertical).toHaveLength(1);
  });

  it('stays armed, so a plan is drawn stroke after stroke', () => {
    draw(point(0, 0), point(5, 0));
    expect(runtime.ui.activeToolId.get()).toBe(PEN_TOOL);
    draw(point(0, 4), point(5, 4));
    expect(walls()).toHaveLength(2);
  });

  it('ignores a tap, which is a finger resting, not a wall', () => {
    runtime.tools.pointerDown({
      point: point(1, 1),
      modifiers: NO_MODS,
      snapped: false,
    });
    runtime.tools.pointerUp({
      point: point(1, 1),
      modifiers: NO_MODS,
      snapped: false,
    });

    expect(walls()).toHaveLength(0);
    expect(runtime.ui.overlay.get().ink).toBeNull();
  });

  it('shows the ink while the stroke is in hand', () => {
    runtime.tools.pointerDown({
      point: point(0, 0),
      modifiers: NO_MODS,
      snapped: false,
    });
    runtime.tools.pointerMove({
      point: point(1, 0),
      modifiers: NO_MODS,
      snapped: false,
    });

    const ink = runtime.ui.overlay.get().ink;
    expect(ink).not.toBeNull();
    expect(ink?.[0].length).toBeGreaterThan(1);
  });

  it('draws onto the danger zone layer like every other tool', () => {
    // the pen is a way of asking for a wall, so a wall it draws inside the zone
    // is zone work — red, and gone when the zone closes
    enterDangerZone(session, runtime.ui);
    runtime.tools.useById(PEN_TOOL);
    draw(point(0, 6), point(5, 6));

    const layer = session.doc.getLayer(walls()[0].layerId);
    expect(layer?.name).toBe('Danger zone');
  });

  it('leaves the locked plan under it alone', () => {
    const corners = [point(0, 0), point(6, 0), point(6, 4), point(0, 4)];
    const original = corners.map((a, i) =>
      session.dispatch<EntityId>('WALL.ADD', {
        a,
        b: corners[(i + 1) % corners.length],
        thickness: 0.3,
      }),
    );
    const survey = () =>
      original
        .map((id) => {
          const w = session.doc.get(id) as WallEntity | null;
          if (!w) return 'GONE';
          const { a, b } = w.getBaseline();
          return `${a.x},${a.y}->${b.x},${b.y}`;
        })
        .join('|');

    enterDangerZone(session, runtime.ui);
    runtime.tools.useById(PEN_TOOL);
    const before = survey();
    // straight across the middle of the original room
    draw(point(3, -1), point(3, 5));

    // the pen DID draw — otherwise this test passes by doing nothing at all
    expect(walls().length).toBe(original.length + 1);
    expect(survey()).toBe(before);
  });

  it('puts the wall on the active layer when there is no zone', () => {
    const other = session.dispatch<LayerId>('LAYER.ADD', { name: 'other' });
    runtime.ui.activeLayerId.set(other);
    draw(point(0, 0), point(5, 0));

    expect(walls()[0].layerId).toBe(other);
  });
});
