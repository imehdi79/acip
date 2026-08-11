import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import { INSERT_ITEMS } from '@/app/components/layout/footer/insert';

/**
 * The Insert menu names tools by id. Nothing checks that at compile time, so a
 * new entry can silently arm nothing at all — which is what this covers.
 */

let session: EditorSession;
let runtime: EditorRuntime;

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
});

describe('the Insert menu', () => {
  it('offers a door alongside the window', () => {
    expect(INSERT_ITEMS.map((item) => item.id)).toEqual([
      'room',
      'wall',
      'window',
      'door',
    ]);
  });

  // 'room' is placed outright and needs no tool — everything else arms one
  const tooled = ['wall', 'window', 'door'] as const;

  it.each(tooled)('arms a registered tool for %s', (id) => {
    runtime.tools.useById(id);
    expect(runtime.ui.activeToolId.get()).toBe(id);
  });

  it('leaves the door tool cancellable, like every other', () => {
    runtime.tools.useById('door');
    expect(runtime.ui.activeToolId.get()).toBe('door');
    runtime.tools.useById('select');
    expect(runtime.ui.activeToolId.get()).toBe('select');
  });
});
