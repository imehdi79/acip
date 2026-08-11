import { describe, expect, it } from 'vitest';
import {
  FOOTER_ITEMS,
  resolveFooter,
  type FooterApi,
} from '@/app/components/layout/footer/actions';
import type { FooterContext } from '@/app/components/layout/footer/context';
import type { User } from '@/app/stores/global/settings.store';

/**
 * The footer's whole decision is one pure function, so "which buttons show
 * right now" is testable from a plain context fixture — no DOM, no session.
 */

const editor: User = { id: 'e', name: 'Editor', role: 'editor' };
const guest: User = { id: 'g', name: 'Guest', role: 'guest' };

const ctx = (patch: Partial<FooterContext> = {}): FooterContext => ({
  view: 'editor',
  selection: 'none',
  types: [],
  count: 0,
  canUndo: false,
  canRedo: false,
  tool: 'select',
  ...patch,
});

const ids = (c: FooterContext, user: User | null = editor) =>
  resolveFooter(FOOTER_ITEMS, c, user).map((r) => r.item.id);

const enabledOf = (c: FooterContext, id: string) =>
  resolveFooter(FOOTER_ITEMS, c, editor).find((r) => r.item.id === id)?.enabled;

describe('resolveFooter', () => {
  it('shows undo and insert on a fresh plan, with undo greyed out', () => {
    expect(ids(ctx())).toEqual(['undo', 'insert']);
    expect(enabledOf(ctx(), 'undo')).toBe(false);
  });

  it('enables undo once there is history', () => {
    expect(enabledOf(ctx({ canUndo: true }), 'undo')).toBe(true);
  });

  it('appears redo only when there is something to redo', () => {
    expect(ids(ctx())).not.toContain('redo');
    expect(ids(ctx({ canRedo: true }))).toEqual(['undo', 'redo', 'insert']);
  });

  it('drops insert once anything is selected', () => {
    expect(
      ids(ctx({ selection: 'wall', types: ['wall'], count: 1 })),
    ).not.toContain('insert');
  });

  it('gives a wall selection its own edit set instead of insert', () => {
    expect(ids(ctx({ selection: 'wall', types: ['wall'], count: 1 }))).toEqual([
      'undo',
      'measure',
      'move-mode',
      'duplicate',
      'delete',
    ]);
  });

  it('offers the room buttons for a room, and no wall-only ones', () => {
    const room = ctx({ selection: 'room', types: ['wall'], count: 4 });
    expect(ids(room)).toEqual([
      'undo',
      'rename',
      'move-mode',
      'duplicate',
      'delete',
    ]);
  });

  it('keeps every contextual button pressable', () => {
    const wall = ctx({ selection: 'wall', types: ['wall'], count: 1 });
    for (const id of ['measure', 'move-mode', 'duplicate', 'delete'])
      expect(enabledOf(wall, id)).toBe(true);
  });

  // a mixed bag of walls and openings is neither a wall nor a room selection
  it('leaves a mixed selection with delete only', () => {
    expect(
      ids(ctx({ selection: 'mixed', types: ['wall', 'window'], count: 2 })),
    ).toEqual(['undo', 'delete']);
  });

  // `selection` is the entity's own type, so a future type needs no change in
  // core, the classifier or the footer — only a descriptor that gates on it.
  it('carries an unknown future entity type through as its own kind', () => {
    expect(
      ids(ctx({ selection: 'stair', types: ['stair'], count: 1 })),
    ).toEqual(['undo', 'delete']);
  });

  it('gives guests nothing, whatever the context', () => {
    const busy = ctx({
      canUndo: true,
      canRedo: true,
      selection: 'room',
      types: ['wall'],
      count: 4,
    });
    expect(ids(busy, guest)).toEqual([]);
  });

  it('offers cancel while a tool is armed, and hides insert behind it', () => {
    // select is the resting tool: nothing to cancel
    expect(ids(ctx())).toEqual(['undo', 'insert']);
    expect(ids(ctx({ tool: 'wall' }))).toEqual(['undo', 'cancel']);
    expect(ids(ctx({ tool: 'window' }))).toEqual(['undo', 'cancel']);
  });

  it('lets even a guest put a tool down', () => {
    // guests hold no footer.* permission, but cancel is ungated on purpose —
    // arming a tool must never be a one-way door
    expect(ids(ctx({ tool: 'wall' }), guest)).toEqual(['cancel']);
  });

  it('cancel returns to the select tool', () => {
    const cancel = FOOTER_ITEMS.find((item) => item.id === 'cancel')!;
    const armed: string[] = [];
    cancel.run?.({
      tools: { useById: (id: string) => armed.push(id) },
    } as unknown as FooterApi);
    expect(armed).toEqual(['select']);
  });

  it('drops the editor-only buttons outside the editor view', () => {
    expect(
      ids(ctx({ view: 'projects', canUndo: true, canRedo: true })),
    ).toEqual([]);
  });

  // the move-mode toggle is only meaningful for things that carry joins
  it('offers move-mode for walls and rooms only', () => {
    expect(
      ids(ctx({ selection: 'wall', types: ['wall'], count: 1 })),
    ).toContain('move-mode');
    expect(
      ids(ctx({ selection: 'room', types: ['wall'], count: 4 })),
    ).toContain('move-mode');
    expect(
      ids(ctx({ selection: 'window', types: ['window'], count: 1 })),
    ).not.toContain('move-mode');
    expect(ids(ctx())).not.toContain('move-mode');
  });
});
