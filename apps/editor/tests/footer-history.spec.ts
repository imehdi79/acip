import { beforeEach, describe, expect, it } from 'vitest';
import { EditorSession, classifySelection, point } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import type { EditorRuntime } from '@/editor/runtime';
import {
  FOOTER_ITEMS,
  resolveFooter,
} from '@/app/components/layout/footer/actions';
import type { FooterContext } from '@/app/components/layout/footer/context';
import type { User } from '@/app/stores/global/settings.store';

/**
 * The footer hears about history from `doc.change` and from nothing else, and
 * it reads canUndo/canRedo from INSIDE that event. So what the bar offers is
 * decided by the snapshot taken there, not by the state a tick later: an undo
 * whose redo only became available after the event left Redo greyed for good,
 * with no second event coming to correct it. These tests drive a real session
 * and resolve the real bar from the context the footer would have kept.
 */

const editor: User = { id: 'e', name: 'Editor', role: 'editor' };

let session: EditorSession;
let runtime: EditorRuntime;

/** context.ts's snapshot(), which it does not export — kept identical here */
const snapshot = (): FooterContext => {
  const info = classifySelection(
    session.doc,
    session.selection.list(),
    runtime.ui.activeLevelId.get(),
  );
  return {
    view: 'editor',
    selection: info.kind,
    types: info.types,
    count: info.count,
    canUndo: session.history.canUndo,
    canRedo: session.history.canRedo,
    tool: runtime.ui.activeToolId.get(),
  };
};

/** every context the footer would have been left holding, in order */
const watchFooter = (): FooterContext[] => {
  const seen: FooterContext[] = [];
  session.doc.events.on('change', () => seen.push(snapshot()));
  return seen;
};

const last = (seen: readonly FooterContext[]): FooterContext => {
  expect(seen.length).toBeGreaterThan(0);
  return seen[seen.length - 1];
};

const enabledOf = (ctx: FooterContext, id: string) =>
  resolveFooter(FOOTER_ITEMS, ctx, editor).find((entry) => entry.item.id === id)
    ?.enabled;

const addWall = (ax: number, ay: number, bx: number, by: number) =>
  session.dispatch<EntityId>('WALL.ADD', {
    a: point(ax, ay),
    b: point(bx, by),
  });

beforeEach(() => {
  session = new EditorSession();
  runtime = createRuntime(session);
});

describe('the footer through an undo/redo round trip', () => {
  it('greys both buttons on a fresh plan', () => {
    const ctx = snapshot();
    expect(enabledOf(ctx, 'undo')).toBe(false);
    expect(enabledOf(ctx, 'redo')).toBe(false);
  });

  it('offers undo as soon as something is drawn', () => {
    const seen = watchFooter();
    addWall(0, 0, 4, 0);
    expect(enabledOf(last(seen), 'undo')).toBe(true);
  });

  it('offers redo once something has been undone', () => {
    addWall(0, 0, 4, 0);
    const seen = watchFooter();

    session.undo();

    // the bug this covers: redo was reachable from the session but never from
    // the bar, because the footer's only news of it arrived a moment too early
    expect(enabledOf(last(seen), 'redo')).toBe(true);
  });

  it('keeps undo pressable after a redo', () => {
    addWall(0, 0, 4, 0);
    session.undo();
    const seen = watchFooter();

    session.redo();

    expect(enabledOf(last(seen), 'undo')).toBe(true);
    expect(enabledOf(last(seen), 'redo')).toBe(false);
  });

  it('walks the whole stack down and back up with the buttons alone', () => {
    // pressing only what the bar says is pressable has to get the user from a
    // drawn plan to an empty one and back — that is the whole feature
    addWall(0, 0, 4, 0);
    addWall(4, 0, 4, 4);
    const seen = watchFooter();

    let ctx = snapshot();
    while (enabledOf(ctx, 'undo') === true) {
      session.undo();
      ctx = last(seen);
    }
    expect(session.doc.count).toBe(0);

    while (enabledOf(ctx, 'redo') === true) {
      session.redo();
      ctx = last(seen);
    }
    expect(session.doc.count).toBe(2);
  });

  it('leaves the footer agreeing with the session after every step', () => {
    const seen = watchFooter();
    const settled: FooterContext[] = [];

    addWall(0, 0, 4, 0);
    settled.push(snapshot());
    addWall(4, 0, 4, 4);
    settled.push(snapshot());
    session.undo();
    settled.push(snapshot());
    session.redo();
    settled.push(snapshot());

    expect(seen).toEqual(settled);
  });
});
