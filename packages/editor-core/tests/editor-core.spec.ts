import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  LineEntity,
  ValidationError,
  RelationError,
  paramsSchema,
  saveDocument,
  loadDocument,
  point,
} from '../src/index.js';
import type {
  Command,
  DocumentChangeEvent,
  EntityId,
  Relation,
  SegmentShape,
} from '../src/index.js';

function addLine(
  session: EditorSession,
  ax: number,
  ay: number,
  bx: number,
  by: number,
) {
  return session.dispatch<EntityId>('LINE.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
  });
}

function segmentOf(session: EditorSession, id: EntityId): SegmentShape {
  const entity = session.doc.get(id);
  expect(entity).not.toBeNull();
  return entity!.getBaseGeometry() as SegmentShape;
}

describe('command bus + entities', () => {
  test('LINE.ADD creates an entity through the bus', () => {
    const session = new EditorSession();
    const id = addLine(session, 0, 0, 10, 0);
    expect(session.doc.count).toBe(1);
    const seg = segmentOf(session, id);
    expect(seg.kind).toBe('segment');
    expect(seg.b.x).toBe(10);
  });

  test('invalid params throw ValidationError and leave the document untouched', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('LINE.ADD', { a: { x: 'no' }, b: point(1, 1) }),
    ).toThrow(ValidationError);
    expect(session.doc.count).toBe(0);
    expect(session.history.canUndo).toBe(false);
  });

  test('a throwing command rolls back everything it did', () => {
    const session = new EditorSession();
    const boom: Command<Record<string, never>, void> = {
      name: 'TEST.BOOM',
      params: paramsSchema(() => ({})),
      execute(ctx) {
        const line = new LineEntity();
        line.setPoints(point(0, 0), point(1, 1));
        ctx.tx.create(line);
        throw new Error('boom');
      },
    };
    session.commands.register(boom);
    expect(() => session.dispatch('TEST.BOOM')).toThrow('boom');
    expect(session.doc.count).toBe(0);
    expect(session.history.canUndo).toBe(false);
  });

  test('change event fires once per commit', () => {
    const session = new EditorSession();
    const events: DocumentChangeEvent[] = [];
    session.doc.events.on('change', (e) => events.push(e));
    addLine(session, 0, 0, 5, 5);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('commit');
    expect(events[0].record.commandName).toBe('LINE.ADD');
    expect(events[0].record.changes.created).toHaveLength(1);
  });
});

describe('undo / redo', () => {
  test('create → undo removes, redo restores same id and props', () => {
    const session = new EditorSession();
    const id = addLine(session, 1, 2, 3, 4);
    session.undo();
    expect(session.doc.count).toBe(0);
    session.redo();
    expect(session.doc.count).toBe(1);
    const seg = segmentOf(session, id);
    expect(seg.a.y).toBe(2);
    expect(seg.b.y).toBe(4);
  });

  test('move → undo restores previous geometry (snapshot-based)', () => {
    const session = new EditorSession();
    const id = addLine(session, 0, 0, 10, 0);
    session.dispatch('ENTITY.MOVE', { ids: [id], delta: point(5, 7) });
    expect(segmentOf(session, id).a).toEqual({ x: 5, y: 7 });
    session.undo();
    expect(segmentOf(session, id).a).toEqual({ x: 0, y: 0 });
    session.redo();
    expect(segmentOf(session, id).b).toEqual({ x: 15, y: 7 });
  });

  test('erase → undo rebuilds the entity via the type registry', () => {
    const session = new EditorSession();
    const id = addLine(session, 0, 0, 2, 2);
    session.dispatch('ENTITY.ERASE', { ids: [id] });
    expect(session.doc.count).toBe(0);
    session.undo();
    expect(session.doc.count).toBe(1);
    expect(segmentOf(session, id).b).toEqual({ x: 2, y: 2 });
  });

  test('nested dispatch joins the parent transaction: one undo unit', () => {
    const session = new EditorSession();
    const composite: Command<Record<string, never>, void> = {
      name: 'TEST.TWO_LINES',
      params: paramsSchema(() => ({})),
      execute() {
        addLine(session, 0, 0, 1, 0);
        addLine(session, 0, 1, 1, 1);
      },
    };
    session.commands.register(composite);
    session.dispatch('TEST.TWO_LINES');
    expect(session.doc.count).toBe(2);
    session.undo();
    expect(session.doc.count).toBe(0);
  });
});

describe('relations (host / attachment)', () => {
  const attachCmd: Command<{ host: EntityId; hosted: EntityId }, Relation> = {
    name: 'TEST.ATTACH',
    params: paramsSchema((input) => {
      const raw = input as { host?: unknown; hosted?: unknown };
      if (typeof raw?.host !== 'string' || typeof raw?.hosted !== 'string') {
        throw new ValidationError('host and hosted ids required');
      }
      return { host: raw.host as EntityId, hosted: raw.hosted as EntityId };
    }),
    execute(ctx, p) {
      return ctx.tx.attach(p.host, p.hosted, 0, { t: 0.5 });
    },
  };

  test('erasing a host cascades to hosted entities, and undo restores both + relation', () => {
    const session = new EditorSession();
    session.commands.register(attachCmd);
    const wall = addLine(session, 0, 0, 10, 0);
    const window_ = addLine(session, 4, 0, 6, 0);
    session.dispatch('TEST.ATTACH', { host: wall, hosted: window_ });
    expect(session.doc.relations.dependentsOf(wall)).toEqual([window_]);

    session.dispatch('ENTITY.ERASE', { ids: [wall] });
    expect(session.doc.count).toBe(0);
    expect(session.doc.relations.all()).toHaveLength(0);

    session.undo();
    expect(session.doc.count).toBe(2);
    expect(session.doc.relations.dependentsOf(wall)).toEqual([window_]);
  });

  test('cycles are rejected', () => {
    const session = new EditorSession();
    session.commands.register(attachCmd);
    const a = addLine(session, 0, 0, 1, 0);
    const b = addLine(session, 0, 1, 1, 1);
    session.dispatch('TEST.ATTACH', { host: a, hosted: b });
    expect(() =>
      session.dispatch('TEST.ATTACH', { host: b, hosted: a }),
    ).toThrow(RelationError);
    expect(session.doc.relations.all()).toHaveLength(1);
  });

  test('change events report dirty downstream entities', () => {
    const session = new EditorSession();
    session.commands.register(attachCmd);
    const wall = addLine(session, 0, 0, 10, 0);
    const window_ = addLine(session, 4, 0, 6, 0);
    session.dispatch('TEST.ATTACH', { host: wall, hosted: window_ });

    const events: DocumentChangeEvent[] = [];
    session.doc.events.on('change', (e) => events.push(e));
    session.dispatch('ENTITY.MOVE', { ids: [wall], delta: point(0, 1) });
    expect(events[0].dirty).toContain(window_);
  });
});

describe('services + io', () => {
  test('snap engine finds the nearest endpoint', () => {
    const session = new EditorSession();
    addLine(session, 0, 0, 10, 0);
    const hit = session.snap.snap(point(0.2, 0.2), 0.5);
    expect(hit?.kind).toBe('endpoint');
    expect(hit?.point).toEqual({ x: 0, y: 0 });
  });

  test('measurement service reads effective geometry', () => {
    const session = new EditorSession();
    const id = addLine(session, 0, 0, 3, 4);
    expect(session.measure.lengthOf(id)).toBe(5);
  });

  test('document round-trips through the native JSON format', () => {
    const session = new EditorSession();
    const a = addLine(session, 0, 0, 10, 0);
    const b = addLine(session, 4, 0, 6, 0);
    session.doc.relations.attach(a, b, 0, { t: 0.4 });

    const data = saveDocument(session.doc);
    const restored = loadDocument(
      JSON.parse(JSON.stringify(data)),
      session.entityTypes,
    );

    expect(restored.count).toBe(2);
    expect(restored.relations.all()).toHaveLength(1);
    const seg = restored.get(a)!.getBaseGeometry() as SegmentShape;
    expect(seg.b.x).toBe(10);
  });
});
