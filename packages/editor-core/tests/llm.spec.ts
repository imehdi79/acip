import { describe, expect, test } from 'bun:test';
import {
  EditorSession,
  commandNameFromTool,
  describeDocument,
  point,
  toolDefinitions,
  toolNameFromCommand,
} from '../src/index.js';
import type { EntityId, JsonObject } from '../src/index.js';

describe('toolDefinitions — command registry as LLM tool catalog', () => {
  test('every registered command becomes a tool with a valid name', () => {
    const session = new EditorSession();
    const tools = toolDefinitions(session.commands);
    expect(tools.length).toBe(session.commands.list().length);
    for (const tool of tools) {
      expect(tool.name).toMatch(/^[a-zA-Z0-9_-]+$/);
      expect(tool.description.length).toBeGreaterThan(0);
      expect(tool.input_schema['type'] ?? 'object').toBe('object');
    }
  });

  test('tool names round-trip to command names', () => {
    expect(toolNameFromCommand('WALL.ADD')).toBe('WALL_ADD');
    expect(commandNameFromTool('WALL_ADD')).toBe('WALL.ADD');
    const session = new EditorSession();
    for (const name of session.commands.list()) {
      expect(commandNameFromTool(toolNameFromCommand(name))).toBe(name);
    }
  });

  test('described commands expose parameter schemas the bus accepts', () => {
    const session = new EditorSession();
    const wallTool = toolDefinitions(session.commands).find((t) => t.name === 'WALL_ADD')!;
    const props = wallTool.input_schema['properties'] as JsonObject;
    expect(Object.keys(props)).toEqual(
      expect.arrayContaining(['a', 'b', 'thickness', 'height', 'levelId', 'typeId']),
    );
    expect(wallTool.input_schema['required']).toEqual(['a', 'b']);
    // an input matching the schema dispatches cleanly
    const id = session.dispatch<EntityId>('WALL.ADD', {
      a: { x: 0, y: 0 },
      b: { x: 4, y: 0 },
      thickness: 0.2,
    });
    expect(session.doc.get(id)).not.toBeNull();
  });
});

describe('describeDocument — LLM digest', () => {
  test('digest carries catalogs, entities, relations, and quantities', () => {
    const session = new EditorSession();
    const levelId = session.dispatch('LEVEL.ADD', { name: 'Ground', elevation: 0 });
    const wallId = session.dispatch<EntityId>('WALL.ADD', {
      a: point(0, 0),
      b: point(6, 0),
      levelId,
    });
    session.dispatch('WINDOW.ADD', { wallId, t: 0.5, width: 1.5 });

    const digest = describeDocument(session.doc);
    const counts = digest['counts'] as JsonObject;
    expect(counts['entities']).toBe(2);
    expect((counts['byType'] as JsonObject)['wall']).toBe(1);
    expect((digest['levels'] as JsonObject[]).map((l) => l['name'])).toContain('Ground');
    expect((digest['relations'] as JsonObject[]).length).toBe(1);
    expect((digest['entities'] as JsonObject[]).some((e) => e['id'] === wallId)).toBe(true);
    const quantities = digest['quantities'] as JsonObject;
    expect(quantities['wallLength']).toBeCloseTo(6);
    expect(quantities['windowCount']).toBe(1);
  });

  test('entity list truncates above maxEntities', () => {
    const session = new EditorSession();
    for (let i = 0; i < 5; i++) {
      session.dispatch('LINE.ADD', { a: point(i, 0), b: point(i, 1) });
    }
    const digest = describeDocument(session.doc, { maxEntities: 3 });
    expect((digest['entities'] as JsonObject[]).length).toBe(3);
    expect(digest['entitiesTruncated']).toBe(2);
  });
});

describe('history grouping — one Ctrl+Z per agent run', () => {
  test('grouped dispatches undo and redo atomically', () => {
    const session = new EditorSession();
    session.history.beginGroup();
    session.dispatch('WALL.ADD', { a: point(0, 0), b: point(5, 0) });
    session.dispatch('WALL.ADD', { a: point(5, 0), b: point(5, 5) });
    session.dispatch('WALL.ADD', { a: point(5, 5), b: point(0, 5) });
    session.history.endGroup();

    expect(session.doc.count).toBe(3);
    expect(session.undo()).toHaveLength(3);
    expect(session.doc.count).toBe(0);
    expect(session.redo()).toHaveLength(3);
    expect(session.doc.count).toBe(3);
  });

  test('runGrouped groups across await points and releases on error', async () => {
    const session = new EditorSession();
    await session.history
      .runGrouped(async () => {
        session.dispatch('WALL.ADD', { a: point(0, 0), b: point(5, 0) });
        await Promise.resolve();
        session.dispatch('WALL.ADD', { a: point(5, 0), b: point(5, 5) });
        throw new Error('agent failed mid-run');
      })
      .catch(() => undefined);

    // partial work is still one atomic undo entry
    expect(session.doc.count).toBe(2);
    expect(session.undo()).toHaveLength(2);
    expect(session.doc.count).toBe(0);
    // group was released — normal dispatch works again
    session.dispatch('LINE.ADD', { a: point(0, 0), b: point(1, 1) });
    expect(session.undo()).toHaveLength(1);
  });

  test('empty group leaves no undo entry', () => {
    const session = new EditorSession();
    session.history.beginGroup();
    session.history.endGroup();
    expect(session.history.canUndo).toBe(false);
  });
});
