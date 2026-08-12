import { describe, expect, it } from 'vitest';
import {
  FOOTER_ITEMS,
  resolveFooter,
  type FooterApi,
} from '@/app/components/layout/footer/actions';
import type { FooterContext } from '@/app/components/layout/footer/context';
import { INSERT_ITEMS } from '@/app/components/layout/footer/insert';
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
    expect(ids(ctx())).toEqual([
      'undo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'tools',
    ]);
    expect(enabledOf(ctx(), 'undo')).toBe(false);
  });

  it('enables undo once there is history', () => {
    expect(enabledOf(ctx({ canUndo: true }), 'undo')).toBe(true);
  });

  it('appears redo only when there is something to redo', () => {
    expect(ids(ctx())).not.toContain('redo');
    expect(ids(ctx({ canRedo: true }))).toEqual([
      'undo',
      'redo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'tools',
    ]);
  });

  it('drops the tools once anything is selected', () => {
    expect(
      ids(ctx({ selection: 'wall', types: ['wall'], count: 1 })),
    ).not.toContain('tools');
  });

  it('gives a wall selection its own edit set instead of insert', () => {
    expect(ids(ctx({ selection: 'wall', types: ['wall'], count: 1 }))).toEqual([
      'undo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
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
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      // a room IS a wall-only selection, so the wall dialog applies to all of it
      'measure',
      'rename',
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
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'measure-opening',
      'door-hang',
      'delete',
    ]);
    expect(
      ids(ctx({ selection: 'window', types: ['window'], count: 1 })),
    ).toEqual([
      'undo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'measure-opening',
      'delete',
    ]);
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
    ).toEqual([
      'undo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'delete',
    ]);
  });

  // `selection` is the entity's own type, so a future type needs no change in
  // core, the classifier or the footer — only a descriptor that gates on it.
  it('carries an unknown future entity type through as its own kind', () => {
    expect(
      ids(ctx({ selection: 'stair', types: ['stair'], count: 1 })),
    ).toEqual([
      'undo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'delete',
    ]);
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

  // the cluster stays put while a tool is armed — it carries the armed tool
  // AND the way to put it down, so there is no separate Cancel to appear
  it('keeps the tools while a tool is armed', () => {
    const bar = [
      'undo',
      'danger-zone',
      'estimator',
      'multi-select',
      'pen',
      'tools',
    ];
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
    expect(ids(ctx({ tool: 'wall' }), guest)).toEqual(['tools']);
  });

  it('gives a guest nothing to arm in the first place', () => {
    // ungated does not mean unguarded: the cluster shows, its tools do not
    expect(ids(ctx(), guest)).toEqual(['tools']);
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

  // the danger zone decides what happens to the NEXT thing drawn, so unlike
  // every other editing button it cannot wait for a selection to exist
  it('offers the danger zone whatever is selected and whatever is armed', () => {
    const anywhere = [
      ctx(),
      ctx({ selection: 'wall', types: ['wall'], count: 1 }),
      ctx({ selection: 'room', types: ['wall'], count: 4 }),
      ctx({ selection: 'window', types: ['window'], count: 1 }),
      ctx({ selection: 'mixed', types: ['wall', 'window'], count: 2 }),
      ctx({ tool: 'wall' }),
    ];
    for (const c of anywhere) expect(ids(c)).toContain('danger-zone');
  });

  it('keeps the danger zone out of the projects view, and away from guests', () => {
    expect(ids(ctx({ view: 'projects' }))).not.toContain('danger-zone');
    expect(ids(ctx(), guest)).not.toContain('danger-zone');
  });

  // it belongs with undo/redo, not with the things done to a selection
  it('sits at the start, in the session run', () => {
    const zone = FOOTER_ITEMS.find((item) => item.id === 'danger-zone')!;
    expect(zone.slot).toBe('start');
    expect(zone.group).toBe('session');
  });

  it('offers the estimator alongside it, whatever is selected', () => {
    const anywhere = [
      ctx(),
      ctx({ selection: 'wall', types: ['wall'], count: 1 }),
      ctx({ selection: 'room', types: ['wall'], count: 4 }),
      ctx({ tool: 'wall' }),
    ];
    for (const c of anywhere) expect(ids(c)).toContain('estimator');
    expect(ids(ctx({ view: 'projects' }))).not.toContain('estimator');
    expect(ids(ctx(), guest)).not.toContain('estimator');
  });

  /*
   * The left of the bar is one control too: undo, redo, the danger zone and
   * the estimator are all about the drawing as a whole. The renderer joins a
   * run only while consecutive items share a group name, so a single stray
   * descriptor would split them into loose pills — and redo comes and goes,
   * which must not break the run either.
   */
  it('gives the start slot a single joined run, with or without redo', () => {
    for (const c of [ctx(), ctx({ canRedo: true })]) {
      const groups = resolveFooter(FOOTER_ITEMS, c, editor)
        .filter((entry) => entry.item.slot === 'start')
        .map((entry) => entry.item.group);
      expect(groups.length).toBeGreaterThan(1);
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
   * Multi-select is the second button whose subject is the next tap rather than
   * the current selection, so it is gated like the danger zone: always there.
   * Gated on a selection it could never start one, and dropped once the
   * selection was complete it would leave the user in a mode with no way out.
   */
  it('offers multi-select whatever is selected and whatever is armed', () => {
    const anywhere = [
      ctx(),
      ctx({ selection: 'wall', types: ['wall'], count: 1 }),
      ctx({ selection: 'wall', types: ['wall'], count: 5 }),
      ctx({ selection: 'room', types: ['wall'], count: 4 }),
      ctx({ selection: 'window', types: ['window'], count: 1 }),
      ctx({ selection: 'mixed', types: ['wall', 'window'], count: 2 }),
      ctx({ tool: 'wall' }),
    ];
    for (const c of anywhere) expect(ids(c)).toContain('multi-select');
  });

  it('keeps multi-select out of the projects view, and away from guests', () => {
    expect(ids(ctx({ view: 'projects' }))).not.toContain('multi-select');
    expect(ids(ctx(), guest)).not.toContain('multi-select');
  });

  // in the half of the bar that does not reflow: the selection run rearranges
  // itself on every tap, and a mode toggle must not move under the thumb
  it('puts multi-select in the session run, not the selection one', () => {
    const toggle = FOOTER_ITEMS.find((item) => item.id === 'multi-select');
    expect(toggle?.slot).toBe('start');
    expect(toggle?.group).toBe('session');
    expect(toggle?.iconOnly).toBe(true);
  });

  /*
   * The pen is asked for by name: "free draw at all times". The tools cluster
   * it would otherwise belong to disappears the moment anything is selected,
   * so the pen sits in the session run instead — reachable mid-edit, with a
   * selection, and while another tool is armed.
   */
  it('offers the pen whatever is selected and whatever is armed', () => {
    const anywhere = [
      ctx(),
      ctx({ selection: 'wall', types: ['wall'], count: 1 }),
      ctx({ selection: 'room', types: ['wall'], count: 4 }),
      ctx({ tool: 'wall' }),
      ctx({ tool: 'sketch' }),
    ];
    for (const c of anywhere) expect(ids(c)).toContain('pen');
  });

  it('keeps the pen out of the projects view, and away from guests', () => {
    expect(ids(ctx({ view: 'projects' }))).not.toContain('pen');
    expect(ids(ctx(), guest)).not.toContain('pen');
  });

  it('puts the pen in the session run, and never in the tools cluster', () => {
    const pen = FOOTER_ITEMS.find((item) => item.id === 'pen');
    expect(pen?.slot).toBe('start');
    expect(pen?.group).toBe('session');
    expect(pen?.iconOnly).toBe(true);
  });

  // the cluster in the middle carries the tools it owns; the pen is not one of
  // them, so an armed pen must not leave it claiming to hold something
  it('keeps the tools cluster from claiming the pen', () => {
    expect(ids(ctx({ tool: 'sketch' }))).toContain('tools');
    expect(INSERT_ITEMS.map((item) => item.id)).not.toContain('sketch');
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

  it('keeps the tools out of the selection run, in the centre', () => {
    const tools = FOOTER_ITEMS.find((item) => item.id === 'tools')!;
    expect(tools.slot).toBe('center');
    expect(tools.group).toBeUndefined();
  });
});
