import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  WallEntity,
  detectSpaces,
  loadDocumentInto,
  point,
  saveDocument,
  wallAssemblyStrips,
} from '../src/index.js';
import type { EntityId, MaterialId, Point, TypeId } from '../src/index.js';

/**
 * A CURVED wall: the same two endpoints, plus how far it turns between them.
 *
 * Chord-and-sweep rather than centre-and-radius, so the endpoints stay the
 * stored truth the rest of the drawing holds on to — joins, grips, snapping,
 * the neighbours welded on. The centre is derived, and a gentle curve has one
 * hundreds of meters off the plan.
 */

const QUARTER = Math.PI / 2;

const session = () => new EditorSession();

const addWall = (s: EditorSession, a: Point, b: Point, thickness = 0.3) =>
  s.dispatch<EntityId>('WALL.ADD', { a, b, thickness });

const wallOf = (s: EditorSession, id: EntityId) => s.doc.get(id) as WallEntity;

const curve = (s: EditorSession, id: EntityId, sweep: number) =>
  s.dispatch('WALL.SETARC', { ids: [id], sweep });

/** a straight wall along +x, one meter long */
const unitWall = (s: EditorSession) => addWall(s, point(0, 0), point(1, 0));

describe('a wall that has not been curved', () => {
  test('is the same four-cornered wall it always was', () => {
    // the whole feature has to cost nothing until it is asked for
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    expect(wallOf(s, id).getOutline()).toEqual([
      { x: 0, y: 0.15 },
      { x: 4, y: 0.15 },
      { x: 4, y: -0.15 },
      { x: 0, y: -0.15 },
    ]);
  });

  test('reports no curvature and offers two grips', () => {
    const s = session();
    const wall = wallOf(s, unitWall(s));
    expect(wall.isCurved()).toBe(false);
    expect(wall.getSweep()).toBe(0);
    expect(wall.getGrips()).toHaveLength(2);
  });

  test('saves exactly what it always saved', () => {
    const s = session();
    unitWall(s);
    expect(JSON.stringify(saveDocument(s.doc))).not.toContain('sweep');
  });
});

describe('a curved wall', () => {
  test('is as long as its arc, not its chord', () => {
    // the length the takeoff prices and the dimension prints
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const radius = 0.5 / Math.sin(QUARTER / 2);
    expect(wallOf(s, id).getLength()).toBeCloseTo(radius * QUARTER, 9);
    expect(wallOf(s, id).getLength()).toBeGreaterThan(1);
  });

  test('still begins and ends exactly where it did', () => {
    // the point of chord-and-sweep: everything welded to this wall is holding
    // on to these two points
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const { a, b } = wallOf(s, id).getBaseline();
    expect(a).toEqual({ x: 0, y: 0 });
    expect(b).toEqual({ x: 1, y: 0 });
  });

  test('bows off the chord', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    // the outline has to leave the strip the straight wall occupied
    const ys = wallOf(s, id)
      .getOutline()
      .map((p) => p.y);
    expect(Math.max(...ys)).toBeGreaterThan(0.2);
  });

  test('bows the other way for a negative sweep', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, -QUARTER);
    const ys = wallOf(s, id)
      .getOutline()
      .map((p) => p.y);
    expect(Math.min(...ys)).toBeLessThan(-0.2);
  });

  test('keeps its thickness all the way round', () => {
    // the band is offset along the LOCAL normal, so it must not pinch or
    // splay where the wall turns
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0), 0.3);
    curve(s, id, QUARTER);
    const wall = wallOf(s, id);
    const arc = wall.getCentreline();
    // every centreline sample should sit half a thickness from both faces
    const outline = wall.getOutline();
    const half = outline.length / 2;
    for (let i = 0; i < half; i++) {
      const plus = outline[i];
      const minus = outline[outline.length - 1 - i];
      expect(Math.hypot(plus.x - minus.x, plus.y - minus.y)).toBeCloseTo(
        0.3,
        6,
      );
    }
    expect(arc.length).toBeGreaterThan(2); // and it really was tessellated
  });

  test('straightens back out, exactly', () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(4, 0));
    curve(s, id, QUARTER);
    curve(s, id, 0);
    expect(wallOf(s, id).isCurved()).toBe(false);
    expect(wallOf(s, id).getOutline()).toHaveLength(4);
    expect(wallOf(s, id).getLength()).toBeCloseTo(4, 9);
  });

  test('cannot be curved past a full turn', () => {
    // the chord vanishes there and the radius runs away
    const s = session();
    const id = unitWall(s);
    curve(s, id, Math.PI * 4);
    expect(Number.isFinite(wallOf(s, id).getLength())).toBe(true);
    expect(Math.abs(wallOf(s, id).getSweep())).toBeLessThan(Math.PI * 2);
  });
});

describe('bending it by hand', () => {
  /** the sweep a drag to `apex` asks for, applied the way the editor applies it */
  const bendTo = (s: EditorSession, id: EntityId, apex: Point) =>
    curve(s, id, wallOf(s, id).planBend(apex).sweep);

  test('offers the middle of the wall as the point to pull', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    // ON the wall, where a finger can reach it, unlike the centre
    expect(wallOf(s, id).getBendPoint().y).toBeGreaterThan(0);
    expect(wallOf(s, id).hitTest(wallOf(s, id).getBendPoint(), 0)).toBe(true);
  });

  test('offers it on a STRAIGHT wall too, at the midpoint', () => {
    // this is what a wall is bent FROM: there is no apex yet, and the middle
    // of the chord is where the handle has to sit for the first drag
    const s = session();
    const wall = wallOf(s, unitWall(s));
    expect(wall.getBendPoint()).toEqual({ x: 0.5, y: 0 });
  });

  test('bends a straight wall to pass under the point pulled to', () => {
    const s = session();
    const id = unitWall(s);
    bendTo(s, id, point(0.5, 0.3));
    expect(wallOf(s, id).isCurved()).toBe(true);
    expect(wallOf(s, id).getBendPoint().x).toBeCloseTo(0.5, 6);
    expect(wallOf(s, id).getBendPoint().y).toBeCloseTo(0.3, 6);
  });

  test('bends a curved wall further the same way', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, 0.4);
    bendTo(s, id, point(0.5, 0.3));
    expect(wallOf(s, id).getBendPoint().y).toBeCloseTo(0.3, 6);
  });

  test('keeps both ends exactly where they were', () => {
    // the whole reason the wall stores a sweep and not a centre: everything
    // welded to those two points stays welded
    const s = session();
    const id = unitWall(s);
    const before = wallOf(s, id).getBaseline();
    bendTo(s, id, point(0.5, 0.3));
    expect(wallOf(s, id).getBaseline()).toEqual(before);
  });

  test('pulling across the chord flips the bow rather than sticking', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, 0.4);
    bendTo(s, id, point(0.5, -0.3));
    expect(wallOf(s, id).getSweep()).toBeLessThan(0);
  });

  test('pulling back onto the chord straightens it', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, 0.4);
    bendTo(s, id, point(0.5, 0));
    expect(wallOf(s, id).isCurved()).toBe(false);
  });

  test('sliding along the chord says nothing about the bend', () => {
    // an arc through two points has its apex at the middle, so only the
    // across-chord part of a drag can mean anything
    const s = session();
    const id = unitWall(s);
    expect(wallOf(s, id).planBend(point(0.9, 0)).sweep).toBe(0);
  });

  test('is not a grip, so nothing that drags corners can drag it', () => {
    // a sticky corner, a resize and a room drag all move every grip they find
    // on a point; the bend point is not a point the wall stores
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    expect(wallOf(s, id).getGrips()).toHaveLength(2);
  });

  test('dragging an endpoint moves the endpoint and keeps the bend', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const before = wallOf(s, id).getSweep();
    s.dispatch('GRIP.MOVE', { id, index: 1, to: point(2, 0) });
    expect(wallOf(s, id).getBaseline().b).toEqual({ x: 2, y: 0 });
    expect(wallOf(s, id).getSweep()).toBeCloseTo(before, 9);
  });
});

describe('finding it on the plan', () => {
  test('a tap on the curve hits it', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const apex = wallOf(s, id).getBendPoint();
    expect(wallOf(s, id).hitTest(apex, 0)).toBe(true);
  });

  test('a tap on the chord it left behind does not', () => {
    // the inside of a bend is empty, and the chord runs right through it
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    expect(wallOf(s, id).hitTest(point(0.5, 0), 0)).toBe(false);
  });

  test('its bounds contain the bow', () => {
    // the spatial index is what junction discovery queries; bounds cut to the
    // chord would lose the wall exactly where it bulges
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const apex = wallOf(s, id).getBendPoint();
    const box = wallOf(s, id).getBounds();
    expect(box.maxY).toBeGreaterThanOrEqual(apex.y);
  });

  test('its midpoint snap is on the wall', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const mid = wallOf(s, id)
      .getSnapPoints(['midpoint'])
      .find((p) => p.kind === 'midpoint');
    expect(mid?.point.y).toBeGreaterThan(0);
  });
});

describe('a curved wall in a junction', () => {
  test('is still joined to its neighbour', () => {
    // curvature changes how the wall is drawn, never where it begins and ends
    const s = session();
    const a = addWall(s, point(0, 0), point(4, 0));
    const b = addWall(s, point(4, 0), point(4, 3));
    curve(s, a, 0.6);
    expect(wallOf(s, a).getJoinsAt('end')).toHaveLength(1);
    expect(wallOf(s, b).getJoinsAt('start')).toHaveLength(1);
  });

  test('miters against the direction it actually arrives from', () => {
    /*
     * The tangent, not the chord. On a curved wall those differ by half the
     * sweep, which is more than enough for a corner cut to the chord to
     * visibly miss.
     */
    const s = session();
    const a = addWall(s, point(0, 0), point(4, 0));
    addWall(s, point(4, 0), point(4, 3));
    const straightCorner = wallOf(s, a)
      .getOutline()
      .map((p) => p.y);
    curve(s, a, 0.6);
    const curvedCorner = wallOf(s, a)
      .getOutline()
      .map((p) => p.y);
    expect(curvedCorner).not.toEqual(straightCorner);
  });
});

describe('doors and windows on a curved wall', () => {
  const withWindow = () => {
    const s = session();
    const id = addWall(s, point(0, 0), point(6, 0));
    const win = s.dispatch<EntityId>('WINDOW.ADD', {
      wallId: id,
      t: 0.5,
      width: 1,
    });
    return { s, id, win };
  };

  test('ride along when the wall is curved', () => {
    // openings were already placed by DISTANCE along the wall, so arc-length
    // parametrisation carries them for free
    const { s, id } = withWindow();
    const before = wallOf(s, id).getSolidSpans().length;
    curve(s, id, QUARTER);
    expect(wallOf(s, id).getSolidSpans()).toHaveLength(before);
  });

  test('still cut the wall in two solid spans', () => {
    const { s, id } = withWindow();
    curve(s, id, QUARTER);
    expect(wallOf(s, id).getSolidSpans()).toHaveLength(2);
  });

  test('take their share of the LONGER wall', () => {
    // a curved wall is longer than its chord, so the same opening leaves more
    // solid behind it, and the takeoff has to see that
    const { s, id } = withWindow();
    const straight = wallOf(s, id)
      .getSolidSpans()
      .reduce((sum, span) => sum + (span.end - span.start), 0);
    curve(s, id, QUARTER);
    const curved = wallOf(s, id)
      .getSolidSpans()
      .reduce((sum, span) => sum + (span.end - span.start), 0);
    expect(curved).toBeGreaterThan(straight);
  });

  test('leave a wall that still meshes as a closed solid', () => {
    const { s, id } = withWindow();
    curve(s, id, QUARTER);
    const mesh = wallOf(s, id).toMesh('coarse');
    expect(mesh.positions.length).toBeGreaterThan(0);
    expect(mesh.indices.length % 3).toBe(0);
  });
});

describe('a room bounded by a curved wall', () => {
  /** a 4x4 room, walls anticlockwise so the interior is on the left */
  const squareRoom = (s: EditorSession) => {
    const c = [point(0, 0), point(4, 0), point(4, 4), point(0, 4)];
    return c.map((a, i) => addWall(s, a, c[(i + 1) % c.length]));
  };

  test('is still detected as a room', () => {
    // the thing that would silently break: a curved room vanishing from the
    // estimator entirely
    const s = session();
    const [bottom] = squareRoom(s);
    curve(s, bottom, -0.8); // bow it outward, away from the room
    expect(detectSpaces(s.doc, null)).toHaveLength(1);
  });

  test('gains the area the bow encloses', () => {
    const s = session();
    const [bottom] = squareRoom(s);
    const before = detectSpaces(s.doc, null)[0].netArea;
    curve(s, bottom, -0.8);
    const after = detectSpaces(s.doc, null)[0].netArea;
    expect(after).toBeGreaterThan(before);
  });

  test('loses area when the bow goes the other way', () => {
    const s = session();
    const [bottom] = squareRoom(s);
    const before = detectSpaces(s.doc, null)[0].netArea;
    curve(s, bottom, 0.8); // bow it into the room
    expect(detectSpaces(s.doc, null)[0].netArea).toBeLessThan(before);
  });

  test('still reports one bounding wall per side, not one per segment', () => {
    // the curve enters the arrangement as many segments under one id; a room
    // that listed the same wall eight times would bill it eight times
    const s = session();
    const [bottom] = squareRoom(s);
    curve(s, bottom, -0.8);
    expect(detectSpaces(s.doc, null)[0].boundaryWallIds).toHaveLength(4);
  });

  test('the bow follows the curve, not the chord', () => {
    /*
     * The number that settles whether this was worth doing. A chord-only
     * arrangement would give back the plain square no matter how hard the
     * wall bowed.
     */
    const s = session();
    const [bottom] = squareRoom(s);
    curve(s, bottom, -0.8);
    const gentle = detectSpaces(s.doc, null)[0].netArea;
    curve(s, bottom, -1.6);
    expect(detectSpaces(s.doc, null)[0].netArea).toBeGreaterThan(gentle);
  });
});

describe('a curve survives', () => {
  test('a save and a reload', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    const reopened = new EditorSession();
    loadDocumentInto(reopened.doc, saveDocument(s.doc), reopened.entityTypes);
    expect(wallOf(reopened, id).getSweep()).toBeCloseTo(QUARTER, 9);
  });

  test('being copied', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    expect(wallOf(s, id).clone().getSweep()).toBeCloseTo(QUARTER, 9);
  });

  test('an undo, which straightens it again', () => {
    const s = session();
    const id = unitWall(s);
    curve(s, id, QUARTER);
    s.history.undo();
    expect(wallOf(s, id).getSweep()).toBe(0);
    expect(wallOf(s, id).isCurved()).toBe(false);
  });

  test('a file written before curves existed, read as straight', () => {
    const s = session();
    const id = unitWall(s);
    const data = JSON.parse(JSON.stringify(saveDocument(s.doc)));
    const reopened = new EditorSession();
    loadDocumentInto(reopened.doc, data, reopened.entityTypes);
    expect(wallOf(reopened, id).getSweep()).toBe(0);
  });
});

describe('healing overlaps around a curved wall', () => {
  test('leaves the curve alone, and the wall crossing its chord too', () => {
    // the chord is not where the wall is: splitting either of them there
    // would cut at a point neither passes through
    const s = session();
    const bowed = addWall(s, point(0, 0), point(6, 0));
    curve(s, bowed, QUARTER);
    const straight = addWall(s, point(2, 0), point(4, 0));

    s.dispatch('WALL.RESOLVE', {});

    expect(wallOf(s, bowed).getBaseline()).toEqual({
      a: { x: 0, y: 0 },
      b: { x: 6, y: 0 },
    });
    expect(wallOf(s, bowed).getSweep()).toBeCloseTo(QUARTER, 9);
    expect(wallOf(s, straight).getBaseline()).toEqual({
      a: { x: 2, y: 0 },
      b: { x: 4, y: 0 },
    });
  });

  test('still splits two straight walls that do overlap', () => {
    const s = session();
    const long = addWall(s, point(0, 0), point(6, 0));
    addWall(s, point(2, 0), point(4, 0));

    s.dispatch('WALL.RESOLVE', {});

    expect(wallOf(s, long).getBaseline()).not.toEqual({
      a: { x: 0, y: 0 },
      b: { x: 6, y: 0 },
    });
  });
});

describe('what else is drawn along a curved wall', () => {
  /** a 6 m wall carrying a 1 m window in the middle */
  const withWindow = (sweep: number) => {
    const s = session();
    const id = addWall(s, point(0, 0), point(6, 0));
    const win = s.dispatch<EntityId>('WINDOW.ADD', {
      wallId: id,
      t: 0.5,
      width: 1,
    });
    if (sweep !== 0) curve(s, id, sweep);
    return { s, id, win };
  };

  test('the window itself sits ON the curve, not back on the chord', () => {
    // `t` was never a position along a straight line — it is a fraction of the
    // distance along the host, and reading it that way is what carries the
    // opening around the bow instead of leaving it behind at the origin
    const { s, id, win } = withWindow(QUARTER);
    const apex = wallOf(s, id).getBendPoint();
    const grips = s.doc.get(win)?.getGrips() ?? [];
    expect(grips).toHaveLength(3);
    expect(grips[0].point.x).toBeCloseTo(apex.x, 6);
    expect(grips[0].point.y).toBeCloseTo(apex.y, 6);
  });

  test('the window is still tappable where it is drawn', () => {
    const { s, id, win } = withWindow(QUARTER);
    const apex = wallOf(s, id).getBendPoint();
    expect(s.doc.get(win)?.hitTest(apex, 0)).toBe(true);
  });

  test('a straight wall places its window exactly where it always did', () => {
    const { s, win } = withWindow(0);
    expect(s.doc.get(win)?.getGrips()[0].point).toEqual({ x: 3, y: 0 });
  });

  test('assembly strips follow the wall round the bend', () => {
    // a strip laid on the chord would sit off the wall entirely on the inside
    // of the bend, which is where the layers are supposed to be thickest
    const s = session();
    const block = s.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Block' });
    const plaster = s.dispatch<MaterialId>('MATERIAL.ADD', { name: 'Plaster' });
    const typeId = s.dispatch<TypeId>('TYPE.ADD', {
      targetType: 'wall',
      name: 'Two layer',
      layers: [
        { materialId: block, thickness: 0.2 },
        { materialId: plaster, thickness: 0.02 },
      ],
    });
    const id = s.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(6, 0),
      typeId,
    });
    curve(s, id, QUARTER);
    const wall = wallOf(s, id);
    const strips = wallAssemblyStrips(s.doc, wall);
    expect(strips).not.toBeNull();
    for (const region of strips?.strips[0].regions ?? []) {
      // every corner of the outermost strip is within the wall's own bounds,
      // and there are more than the four a chord would have
      expect(region.boundary.length).toBeGreaterThan(4);
      for (const p of region.boundary) {
        expect(wall.hitTest(p, 1e-6)).toBe(true);
      }
    }
  });
});
