import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, WallEntity } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import {
  MAX_INLINE_TOOLS,
  splitTools,
  useTool,
  type ToolItem,
} from '@/app/components/layout/footer/tools';
import { INSERT_ITEMS } from '@/app/components/layout/footer/insert';

/**
 * The tool cluster: which tools stand in the bar, which fold into the menu,
 * and what pressing one does.
 */

let session: EditorSession;
let runtime: EditorRuntime;

const fake = (n: number): ToolItem[] =>
  Array.from({ length: n }, (_, i) => ({
    id: 'wall',
    label: `tool ${i}`,
    icon: null,
  }));

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
});

describe('splitTools', () => {
  it('stands every tool in the bar while they fit', () => {
    const { inline, folded } = splitTools(fake(MAX_INLINE_TOOLS));
    expect(inline).toHaveLength(MAX_INLINE_TOOLS);
    expect(folded).toEqual([]);
  });

  it('folds the overflow away once there is one too many', () => {
    const { inline, folded } = splitTools(fake(MAX_INLINE_TOOLS + 1));
    // the menu takes a slot of its own, so the last inline tool joins it
    // rather than leaving a menu holding one entry
    expect(inline).toHaveLength(MAX_INLINE_TOOLS - 1);
    expect(folded).toHaveLength(2);
  });

  it('never loses or repeats a tool', () => {
    for (const count of [1, 4, 5, 9]) {
      const items = fake(count);
      const { inline, folded } = splitTools(items);
      expect([...inline, ...folded]).toEqual(items);
    }
  });

  it('keeps all four of today tools in the bar', () => {
    expect(INSERT_ITEMS).toHaveLength(4);
    expect(splitTools(INSERT_ITEMS).folded).toEqual([]);
  });
});

describe('useTool', () => {
  it('arms a tool for the ones that draw', () => {
    for (const id of ['wall', 'window', 'door'] as const) {
      useTool(id, session, runtime.ui, runtime.tools);
      expect(runtime.ui.activeToolId.get()).toBe(id);
    }
  });

  it('places a room outright, arming nothing', () => {
    useTool('room', session, runtime.ui, runtime.tools);

    expect(runtime.ui.activeToolId.get()).toBe('select');
    expect(
      session.doc.all().filter((e) => e instanceof WallEntity),
    ).toHaveLength(4);
  });

  it('leaves the placed room selected, ready to size', () => {
    useTool('room', session, runtime.ui, runtime.tools);
    expect(session.selection.list()).toHaveLength(4);
  });
});

describe('putting a tool down', () => {
  it('goes back to select, which is what the armed button does', () => {
    useTool('wall', session, runtime.ui, runtime.tools);
    expect(runtime.ui.activeToolId.get()).toBe('wall');

    // pressing the armed tool again is exactly this
    runtime.tools.useById('select');

    expect(runtime.ui.activeToolId.get()).toBe('select');
  });
});
