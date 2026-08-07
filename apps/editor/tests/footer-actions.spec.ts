import { describe, expect, it } from 'vitest';
import {
  FOOTER_ITEMS,
  resolveFooter,
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
  count: 0,
  canUndo: false,
  canRedo: false,
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

  it('swaps insert for delete once anything is selected', () => {
    expect(ids(ctx({ selection: 'wall', count: 1 }))).toEqual([
      'undo',
      'delete',
    ]);
  });

  it('adds duplicate for a room selection, disabled until the command exists', () => {
    const room = ctx({ selection: 'room', count: 1 });
    expect(ids(room)).toEqual(['undo', 'duplicate', 'delete']);
    expect(enabledOf(room, 'duplicate')).toBe(false);
  });

  it('gives guests nothing, whatever the context', () => {
    const busy = ctx({
      canUndo: true,
      canRedo: true,
      selection: 'room',
      count: 1,
    });
    expect(ids(busy, guest)).toEqual([]);
  });

  it('drops the editor-only buttons outside the editor view', () => {
    expect(
      ids(ctx({ view: 'projects', canUndo: true, canRedo: true })),
    ).toEqual([]);
  });
});
