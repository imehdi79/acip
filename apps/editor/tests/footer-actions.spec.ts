import { describe, expect, it } from 'vitest';
import {
  FOOTER_ITEMS,
  resolveFooter,
  type FooterApi,
} from '@/app/components/layout/footer/actions';
import type { FooterContext } from '@/app/components/layout/footer/context';
import { INSERT_ITEMS } from '@/app/components/layout/footer/insert';
import { MODE_ITEMS } from '@/app/components/layout/footer/modes';
import { can, type User } from '@/app/stores/global/settings.store';

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
  it('shows undo and the tools on a fresh plan, with undo greyed out', () => {
    expect(ids(ctx())).toEqual(['undo', 'redo', 'modes', 'floors', 'tools']);
    expect(enabledOf(ctx(), 'undo')).toBe(false);
  });

  it('enables undo once there is history', () => {
    expect(enabledOf(ctx({ canUndo: true }), 'undo')).toBe(true);
  });

  // it used to appear only when it had work to do, which kept the bar tidy at
  // the cost of undo — the button beside it — jumping sideways on every edit
  it('always shows redo, greyed until there is something to redo', () => {
    expect(ids(ctx())).toContain('redo');
    expect(enabledOf(ctx(), 'redo')).toBe(false);
    expect(enabledOf(ctx({ canRedo: true }), 'redo')).toBe(true);
  });

  it('drops the tools once anything is selected', () => {
    expect(
      ids(ctx({ selection: 'wall', types: ['wall'], count: 1 })),
    ).not.toContain('tools');
  });

  it('gives a wall selection its own edit set instead of insert', () => {
    expect(ids(ctx({ selection: 'wall', types: ['wall'], count: 1 }))).toEqual([
      'undo',
      'redo',
      'modes',
      'floors',
      'measure',
      // only walls can bow, so this sits with the wall-only set
      'curve-wall',
      'move-mode',
      'duplicate',
      'delete',
    ]);
  });

  it('offers the room buttons for a room, and no wall-only ones', () => {
    const room = ctx({ selection: 'room', types: ['wall'], count: 4 });
    expect(ids(room)).toEqual([
      'undo',
      'redo',
      'modes',
      'floors',
      // a room IS a wall-only selection, so the wall dialog applies to all of it
      'measure',
      'rename',
      // bowing one side of a room is the commonest reason to want a curve
      'curve-wall',
      'move-mode',
      'duplicate',
      'delete',
    ]);
  });

  // openings get their own measurements button: the wall one asks for a
  // length and knows nothing about a sill
  it('gives a window and a door the opening measurements button', () => {
    for (const kind of ['window', 'door']) {
      expect(ids(ctx({ selection: kind, types: [kind], count: 1 }))).toContain(
        'measure-opening',
      );
    }
  });

  // only a door has a leaf to rehang, so the window must not offer it
  it('offers the hang toggle for a door alone', () => {
    expect(ids(ctx({ selection: 'door', types: ['door'], count: 1 }))).toEqual([
      'undo',
      'redo',
      'modes',
      'floors',
      'measure-opening',
      'door-hang',
      'delete',
    ]);
    expect(
      ids(ctx({ selection: 'window', types: ['window'], count: 1 })),
    ).toEqual(['undo', 'redo', 'modes', 'floors', 'measure-opening', 'delete']);
  });

  it('never offers both measurements buttons at once', () => {
    expect(
      ids(ctx({ selection: 'wall', types: ['wall'], count: 1 })),
    ).not.toContain('measure-opening');
    expect(
      ids(ctx({ selection: 'window', types: ['window'], count: 1 })),
    ).not.toContain('measure');
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
    ).toEqual(['undo', 'redo', 'modes', 'floors', 'delete']);
  });

  // `selection` is the entity's own type, so a future type needs no change in
  // core, the classifier or the footer — only a descriptor that gates on it.
  it('carries an unknown future entity type through as its own kind', () => {
    expect(
      ids(ctx({ selection: 'stair', types: ['stair'], count: 1 })),
    ).toEqual(['undo', 'redo', 'modes', 'floors', 'delete']);
  });

  it('gives guests nothing they can act on, whatever the context', () => {
    const busy = ctx({
      canUndo: true,
      canRedo: true,
      selection: 'room',
      types: ['wall'],
      count: 4,
    });
    // only the ungated modes menu resolves (the tools cluster is hidden by the
    // selection), and it renders nothing for a user who may use none of what it
    // holds — see the per-item gates below
    expect(ids(busy, guest)).toEqual(['modes', 'floors']);
  });

  // the cluster stays put while a tool is armed — it carries the armed tool
  // AND the way to put it down, so there is no separate Cancel to appear
  it('keeps the tools while a tool is armed', () => {
    const bar = ['undo', 'redo', 'modes', 'floors', 'tools'];
    expect(ids(ctx())).toEqual(bar);
    expect(ids(ctx({ tool: 'wall' }))).toEqual(bar);
    expect(ids(ctx({ tool: 'window' }))).toEqual(bar);
  });

  it('keeps the tools visible even with a selection, while one is armed', () => {
    // otherwise arming a tool and then tapping something would strand it
    expect(
      ids(ctx({ tool: 'wall', selection: 'wall', types: ['wall'], count: 1 })),
    ).toContain('tools');
  });

  it('lets even a guest put a tool down', () => {
    // guests hold no footer.* permission, but the cluster is ungated on
    // purpose — arming a tool must never be a one-way door
    expect(ids(ctx({ tool: 'wall' }), guest)).toEqual([
      'modes',
      'floors',
      'tools',
    ]);
  });

  it('gives a guest nothing to arm in the first place', () => {
    // ungated does not mean unguarded: the cluster shows, its tools do not
    expect(ids(ctx(), guest)).toEqual(['modes', 'floors', 'tools']);
    expect(can(guest, 'footer.insert')).toBe(false);
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

  /*
   * The modes — free draw, multi-select, the danger zone, the estimator — live
   * behind one menu, and whichever is live puts its own button back beside
   * undo/redo. The menu itself is in the bar at all times: each of them decides
   * what the NEXT tap does, so one gated on a selection could never be started,
   * and one that vanished once a selection existed would strand the user in a
   * mode with no way out of it.
   */
  it('offers the modes menu whatever is selected and whatever is armed', () => {
    const anywhere = [
      ctx(),
      ctx({ selection: 'wall', types: ['wall'], count: 1 }),
      ctx({ selection: 'wall', types: ['wall'], count: 5 }),
      ctx({ selection: 'room', types: ['wall'], count: 4 }),
      ctx({ selection: 'window', types: ['window'], count: 1 }),
      ctx({ selection: 'mixed', types: ['wall', 'window'], count: 2 }),
      ctx({ tool: 'wall' }),
      ctx({ tool: 'sketch' }),
    ];
    for (const c of anywhere) expect(ids(c)).toContain('modes');
  });

  it('keeps the modes menu out of the projects view', () => {
    expect(ids(ctx({ view: 'projects' }))).not.toContain('modes');
  });

  // in the half of the bar that does not reflow: the selection run rearranges
  // itself on every tap, and a mode toggle must not move under the thumb
  it('puts the modes menu in the session run, not the selection one', () => {
    const modes = FOOTER_ITEMS.find((item) => item.id === 'modes');
    expect(modes?.slot).toBe('start');
    expect(modes?.group).toBe('session');
  });

  /*
   * Folding four buttons into a menu must not be a way of losing their gates.
   * The menu is ungated as a descriptor — like the tools cluster, because the
   * way OUT of a mode cannot be gated away — so every entry carries its own.
   */
  it('gates every mode in the menu, one by one', () => {
    expect(MODE_ITEMS.length).toBeGreaterThan(0);
    for (const item of MODE_ITEMS) {
      expect(item.permission).toBeTruthy();
      expect(can(editor, item.permission)).toBe(true);
      expect(can(guest, item.permission)).toBe(false);
    }
  });

  /*
   * The left of the bar is one control: undo, redo and the modes menu. The
   * renderer joins a run only while consecutive items share a group name, so a
   * single stray descriptor would split them into loose pills.
   */
  it('gives the start slot a single joined run', () => {
    for (const c of [ctx(), ctx({ canRedo: true })]) {
      const groups = resolveFooter(FOOTER_ITEMS, c, editor)
        .filter((entry) => entry.item.slot === 'start')
        .map((entry) => entry.item.group);
      // undo, redo, modes, floors — the drawing-as-a-whole run
      expect(groups.length).toBe(4);
      // the point of the test: ONE group, so they render as a single joined
      // control rather than as four buttons that happen to be adjacent
      expect(new Set(groups)).toEqual(new Set(['session']));
    }
  });

  /*
   * Every button a selected shape offers has to read as ONE control, the way
   * the wall's set does — the renderer joins a run of buttons into a group
   * only while they share a group name, so a stray one fragments the row.
   */
  it('gives every shape a single joined run of buttons', () => {
    const shapes = [
      ctx({ selection: 'wall', types: ['wall'], count: 1 }),
      ctx({ selection: 'room', types: ['wall'], count: 4 }),
      ctx({ selection: 'window', types: ['window'], count: 1 }),
      ctx({ selection: 'door', types: ['door'], count: 1 }),
      ctx({ selection: 'mixed', types: ['wall', 'window'], count: 2 }),
    ];
    for (const shape of shapes) {
      const groups = resolveFooter(FOOTER_ITEMS, shape, editor)
        .filter((entry) => entry.item.slot === 'end')
        .map((entry) => entry.item.group);
      expect(groups.length).toBeGreaterThan(0);
      expect(new Set(groups).size).toBe(1);
      expect(groups[0]).toBe('selection');
    }
  });

  /*
   * What multi-select is FOR: several walls in front of one dialog. A gathered
   * set of walls that happens to close a loop classifies as a room, and hiding
   * the measurements button for exactly that selection would defeat the
   * commonest multi-wall edit there is.
   */
  it('offers the wall measurements dialog for a room too', () => {
    const room = ctx({ selection: 'room', types: ['wall'], count: 4 });
    expect(ids(room)).toContain('measure');
    expect(ids(room)).not.toContain('measure-opening');
    expect(enabledOf(room, 'measure')).toBe(true);
  });

  // the tools stand with the buttons that act on the drawing, at the end of the
  // bar — the left is the session around it, the right is the plan in front of
  // it. They keep their own group, so they read as a cluster of their own.
  it('puts the tools at the end, beside the selection run', () => {
    const tools = FOOTER_ITEMS.find((item) => item.id === 'tools');
    expect(tools?.slot).toBe('end');
    expect(tools?.group).toBeUndefined();
  });

  // the pen is a mode, not one of the insert tools, so an armed pen must not
  // leave the cluster claiming to hold something
  it('keeps the tools cluster from claiming the pen', () => {
    expect(INSERT_ITEMS.map((item) => item.id)).not.toContain('sketch');
  });
});
