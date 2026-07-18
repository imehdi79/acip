import { describe, expect, test } from 'bun:test';
import { EditorSession, toolDefinitions } from '../src/index.js';

describe('REQUEST.LOG — signal command for unfulfillable requests', () => {
  test('dispatches without touching the document', () => {
    const session = new EditorSession();
    const result = session.dispatch<string>('REQUEST.LOG', {
      kind: 'missing-feature',
      text: 'curved walls',
      context: 'user asked for a radius wall on level 0',
    });
    expect(result).toContain('curved walls');
    expect(session.doc.count).toBe(0);
  });

  test('validates kind and text', () => {
    const session = new EditorSession();
    expect(() =>
      session.dispatch('REQUEST.LOG', { kind: 'nonsense', text: 'x' }),
    ).toThrow();
    expect(() =>
      session.dispatch('REQUEST.LOG', { kind: 'missing-price' }),
    ).toThrow();
  });

  test('is exposed to agents as the REQUEST_LOG tool', () => {
    const session = new EditorSession();
    const names = toolDefinitions(session.commands).map((t) => t.name);
    expect(names).toContain('REQUEST_LOG');
  });
});
