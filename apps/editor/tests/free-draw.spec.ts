import { beforeEach, describe, expect, it } from 'vitest';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  point,
} from '@acip/editor-core';
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

  /*
   * Touch decides between "the tool wants this drag" and "one finger pans the
   * canvas" by asking the tool, and a tool that does not answer gets a pan. The
   * pen did not answer, so on a phone a stroke panned the plan and drew
   * nothing — the one gesture the tool has was the one it never received.
   */
  it('claims the drag, so a finger draws instead of panning', () => {
    expect(runtime.tools.hitDraggable(point(9, 9), 0.2)).toBe(true);
    // anywhere on the plan: under a pen there is nothing to be over
    expect(runtime.tools.hitDraggable(point(-40, 12), 0.2)).toBe(true);
  });

  it('is the select tool that leaves a finger free to pan', () => {
    // select claims a drag only when something draggable is under the finger,
    // which is what makes empty ground pan instead
    runtime.tools.useById('select');
    expect(runtime.tools.hitDraggable(point(9, 9), 0.2)).toBe(false);
  });

  /*
   * The recognizer welds a stroke's OWN corners and knows nothing else, so a
   * second stroke used to come out a centimetre or two off the first one's
   * corners — and a centimetre is a mile. Walls that do not share an endpoint
   * do not join, so their caps do not miter (they overshoot and lie across
   * each other), and the loop does not close, so no room is detected.
   *
   * A wall placed by tapping never has this problem: the taps are snapped to
   * existing geometry before the command sees them. The pen has to end up in
   * the same place.
   */
  describe('drawn against what is already there', () => {
    /** a closed rectangle in one stroke */
    const room = (x0: number, y0: number, x1: number, y1: number) =>
      draw(
        point(x0, y0),
        point(x1, y0),
        point(x1, y1),
        point(x0, y1),
        point(x0, y0),
      );

    it('makes a room under a room, sharing the wall between them', () => {
      room(0, 0, 7, 5);
      expect(detectSpaces(session.doc, null)).toHaveLength(1);

      // the second stroke misses the first one's corners by a hand's width
      draw(
        point(0.04, -0.03),
        point(7.03, 0.02),
        point(7.02, -5),
        point(0.02, -5),
        point(0.03, -0.02),
      );

      const rooms = detectSpaces(session.doc, null);
      expect(rooms).toHaveLength(2);
      // and no sliver between them: a 2 cm gap left as its own "room" is the
      // shape of the bug, not a room anybody drew
      for (const space of rooms) expect(space.netArea).toBeGreaterThan(5);
    });

    it('welds a stroke onto the corner it was aimed at', () => {
      session.dispatch('WALL.ADD', {
        a: point(0, 0),
        b: point(6, 0),
        thickness: 0.3,
      });
      // start a hand's width off the existing end
      draw(point(6.08, 0.06), point(6.05, 4));

      const drawn = walls().find((w) => w.getBaseline().b.y > 3);
      // welded, so the corner miters instead of the two walls crossing
      expect(drawn?.getJoinsAt('start') ?? []).not.toHaveLength(0);
    });

    it('leaves a stroke that is near nothing exactly where it was drawn', () => {
      session.dispatch('WALL.ADD', {
        a: point(0, 0),
        b: point(6, 0),
        thickness: 0.3,
      });
      draw(point(0, 9), point(6, 9));

      const away = walls().find((w) => w.getBaseline().a.y > 8);
      expect(away).toBeDefined();
      // welding must not reach across the plan and drag a wall onto something
      // metres away — it is a hand's imprecision, not a magnet
      expect(away?.getBaseline().a.y ?? 0).toBeGreaterThan(8);
      expect(away?.getJoinsAt('start') ?? []).toHaveLength(0);
    });
  });

  describe('guidance', () => {
    /** part-way through a stroke, still pressed */
    const halfDrawn = () => {
      runtime.tools.pointerDown({
        point: point(0, 0),
        modifiers: NO_MODS,
        snapped: false,
      });
      for (let i = 1; i <= 20; i++) {
        runtime.tools.pointerMove({
          point: { x: i * 0.25, y: i % 2 ? 0.02 : -0.02 },
          modifiers: NO_MODS,
          snapped: false,
        });
      }
    };

    it('previews the walls the ink will become, before the finger lifts', () => {
      halfDrawn();
      const ghost = runtime.ui.overlay.get().ghost;

      // freehand is the one tool where what you draw is not what you get, so
      // the straightened result is shown while there is still time to change it
      expect(ghost).not.toBeNull();
      expect(ghost?.length).toBeGreaterThan(0);
      expect(ghost?.[0].kind).toBe('segment');
    });

    it('reads out the length of the run under the finger', () => {
      halfDrawn();
      const rubber = runtime.ui.overlay.get().rubber;

      expect(rubber).not.toBeNull();
      const drawn = Math.hypot(
        (rubber?.b.x ?? 0) - (rubber?.a.x ?? 0),
        (rubber?.b.y ?? 0) - (rubber?.a.y ?? 0),
      );
      // the readout measures the RECOGNIZED wall, not the wandering ink
      expect(drawn).toBeCloseTo(5, 1);
    });

    it('takes the guidance away with the stroke', () => {
      halfDrawn();
      runtime.tools.pointerUp({
        point: point(5, 0),
        modifiers: NO_MODS,
        snapped: false,
      });

      const overlay = runtime.ui.overlay.get();
      expect(overlay.ghost).toBeNull();
      expect(overlay.rubber).toBeNull();
      expect(overlay.ink).toBeNull();
      // and the wall it was previewing is now on the plan
      expect(walls()).toHaveLength(1);
    });

    it('drops the ghost when Escape throws the stroke away', () => {
      halfDrawn();
      runtime.tools.key('Escape');

      const overlay = runtime.ui.overlay.get();
      expect(overlay.ghost).toBeNull();
      expect(overlay.ink).toBeNull();
      expect(walls()).toHaveLength(0);
      // the pen is still in hand — Escape drops the stroke, not the tool
      expect(runtime.ui.activeToolId.get()).toBe(PEN_TOOL);
    });
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
