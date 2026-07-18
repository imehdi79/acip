import { describe, expect, test } from 'bun:test';
import {
  ArcEntity,
  CircleEntity,
  EditorSession,
  PolylineEntity,
  distanceToArc,
  distanceToPolyline,
  isAngleInArc,
  loadDocument,
  point,
  saveDocument,
} from '../src/index.js';
import type { EntityId } from '../src/index.js';

describe('curve math', () => {
  test('isAngleInArc handles wrap-around sweeps', () => {
    // arc from 270° to 90° passes through 0°
    const start = (3 * Math.PI) / 2;
    const end = Math.PI / 2;
    expect(isAngleInArc(0, start, end)).toBe(true);
    expect(isAngleInArc(Math.PI, start, end)).toBe(false);
  });

  test('distanceToArc falls back to endpoints outside the sweep', () => {
    const c = point(0, 0);
    // quarter arc in the first quadrant
    expect(distanceToArc(point(2, 0), c, 1, 0, Math.PI / 2)).toBeCloseTo(1);
    // opposite side: nearest endpoint is (1,0) at distance 1 from (0,-...
    expect(distanceToArc(point(0, -1), c, 1, 0, Math.PI / 2)).toBeCloseTo(
      Math.SQRT2,
      5,
    );
  });

  test('distanceToPolyline includes the closing segment only when closed', () => {
    const pts = [point(0, 0), point(4, 0), point(4, 4)];
    const probe = point(2, 2); // near the (0,0)-(4,4) closing diagonal
    expect(distanceToPolyline(probe, pts, true)).toBeCloseTo(0);
    expect(distanceToPolyline(probe, pts, false)).toBeCloseTo(2);
  });
});

describe('primitive commands and entities', () => {
  test('CIRCLE.ADD: geometry, measure, quadrant grips resize', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('CIRCLE.ADD', {
      center: point(2, 2),
      radius: 1.5,
    });
    const circle = session.doc.get(id) as CircleEntity;
    expect(circle).toBeInstanceOf(CircleEntity);
    expect(session.measure.areaOf(id)).toBeCloseTo(Math.PI * 1.5 * 1.5);
    expect(session.measure.lengthOf(id)).toBeCloseTo(2 * Math.PI * 1.5);

    session.dispatch('GRIP.MOVE', { id, index: 1, to: point(5, 2) }); // east quadrant
    expect(circle.radius).toBeCloseTo(3);
    session.dispatch('GRIP.MOVE', { id, index: 0, to: point(0, 0) }); // center moves
    expect(circle.getCenter()).toEqual(point(0, 0));
    expect(circle.radius).toBeCloseTo(3);
  });

  test('ARC.ADD: hit test on the sweep, endpoint grip adjusts angle', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('ARC.ADD', {
      center: point(0, 0),
      radius: 2,
      startAngle: 0,
      endAngle: Math.PI / 2,
    });
    const arc = session.doc.get(id) as ArcEntity;
    expect(arc.hitTest(point(2, 0), 0.1)).toBe(true);
    expect(arc.hitTest(point(-2, 0), 0.1)).toBe(false);

    session.dispatch('GRIP.MOVE', { id, index: 2, to: point(-3, 0) });
    expect(arc.endAngle).toBeCloseTo(Math.PI);
    expect(arc.radius).toBeCloseTo(3);
  });

  test('POLYLINE.ADD: vertices, closed area, vertex grip stretch, round-trip', () => {
    const session = new EditorSession();
    const id = session.dispatch<EntityId>('POLYLINE.ADD', {
      points: [point(0, 0), point(4, 0), point(4, 3), point(0, 3)],
      closed: true,
    });
    const poly = session.doc.get(id) as PolylineEntity;
    expect(session.measure.areaOf(id)).toBeCloseTo(12);
    expect(session.measure.lengthOf(id)).toBeCloseTo(14);

    session.dispatch('GRIP.MOVE', { id, index: 2, to: point(6, 3) });
    expect(poly.getPoints()[2]).toEqual(point(6, 3));

    const restored = loadDocument(
      JSON.parse(JSON.stringify(saveDocument(session.doc))),
      session.entityTypes,
    );
    const loaded = restored.all()[0] as PolylineEntity;
    expect(loaded.getPoints()).toHaveLength(4);
    expect(loaded.closed).toBe(true);
    expect(loaded.getPoints()[2]).toEqual(point(6, 3));
  });

  test('POLYLINE.ADD rejects fewer than 2 points', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('POLYLINE.ADD', { points: [point(0, 0)] }),
    ).toThrow('at least 2');
  });

  test('primitives surface in the agent tool catalog and undo cleanly', () => {
    const session = new EditorSession();
    const names = session.commands.list();
    expect(names).toEqual(
      expect.arrayContaining(['CIRCLE.ADD', 'ARC.ADD', 'POLYLINE.ADD']),
    );
    session.dispatch('CIRCLE.ADD', { center: point(0, 0), radius: 1 });
    session.undo();
    expect(session.doc.count).toBe(0);
  });
});
