import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  EditorUi,
  type MeasureMode,
  type ResizeReach,
} from '@/editor/ui-state';
import { moreItems } from '@/app/components/layout/header/more';
import { SettingsPanel } from '@/app/components/layout/header/settings';
import { can, type User } from '@/app/stores/global/settings.store';

/**
 * Settings is the header menu's second row and the only screen behind it, so
 * two things are worth pinning down: that the row is offered to exactly the
 * roles that hold `header.settings`, and that what opens is a control which
 * SHOWS which way the plan is being measured.
 *
 * Both are read the only way this app can read them — the menu as data, and the
 * panel as static markup. There is no DOM to tap in, so nothing here simulates
 * a press; the panel is handed a state and asked what it renders.
 */

const viewer: User = { id: 'v', name: 'Viewer', role: 'viewer' };
const guest: User = { id: 'g', name: 'Guest', role: 'guest' };

/** the menu as the header builds it for this user */
const itemsFor = (user: User) =>
  moreItems(can(user, 'header.settings')).map((item) => item.id);

/** the panel with the editor sitting in `mode` */
const panel = (mode: MeasureMode, reach: ResizeReach = 'linked') => {
  const ui = new EditorUi();
  ui.measureMode.set(mode);
  ui.resizeReach.set(reach);
  return renderToStaticMarkup(<SettingsPanel ui={ui} />);
};

/**
 * One toggle group's markup, by position.
 *
 * The sheet holds more than one now, and every assertion about "which option
 * is on" has to name WHICH question it is asking about — counting checked
 * buttons across the whole panel would pass no matter how the groups were
 * wired to each other.
 */
const groupAt = (html: string, index: number) => {
  const parts = html.split('<div data-slot="toggle-button-group"');
  return parts[index + 1] ?? '';
};

/** the label of the option the markup says is on */
const checkedLabel = (html: string) => {
  const from = html.slice(html.indexOf('aria-checked="true"'));
  return from.slice(from.indexOf('>') + 1, from.indexOf('</button>'));
};

describe('the header menu', () => {
  it('offers Settings to a viewer, who holds the permission', () => {
    // a viewer changing which faces are dimensioned changes nothing in the
    // document, so the gate is deliberately wider than the editing set
    // Save and Open sit with Create New: all three answer "which drawing am I
    // in", and none of them is gated — a plan somebody spent an afternoon on
    // should not need a role to survive the tab closing
    expect(itemsFor(viewer)).toEqual([
      'create-new',
      'save',
      'open',
      'settings',
    ]);
  });

  it('offers a guest the way out and nothing else', () => {
    expect(itemsFor(guest)).toEqual(['create-new', 'save', 'open']);
  });

  it('never drops Create New, whoever is asking', () => {
    // it replaced Back: a role that lost it would be stuck in the editor
    for (const items of [itemsFor(viewer), itemsFor(guest)]) {
      expect(items[0]).toBe('create-new');
    }
    expect(moreItems(true)[0].label).toBe('Create New');
  });
});

describe('the settings panel', () => {
  it('names both ways of measuring rather than showing a bare switch', () => {
    const html = panel('outside');
    // the words in the brackets are the point: "inside" and "outside" name
    // faces of a wall, which means nothing to someone reading a phone
    expect(html).toContain('Outside (overall)');
    expect(html).toContain('Inside (clear)');
    // and it reads as a choice between two, not as a toggle left down
    expect(html).toContain('role="radiogroup"');
  });

  it('shows the mode the editor is actually in', () => {
    expect(checkedLabel(panel('outside'))).toBe('Outside (overall)');
    expect(checkedLabel(panel('inside'))).toBe('Inside (clear)');
    // and shows it, rather than only announcing it: the fill hangs off
    // data-selected, so a mode that is readable but not visible would be a
    // control nobody can use with their eyes
    expect(panel('inside')).toContain('data-selected="true"');
  });

  it('keeps both options direct children of the group', () => {
    // the joined segmented shape comes from :first-child/:last-child on the
    // group's own children, so anything wrapping one of them rounds it off into
    // a loose pill — the same trap the footer's button run has fallen into
    const html = panel('outside');
    const group = html.slice(
      html.indexOf('<div data-slot="toggle-button-group"'),
    );
    const inside = group.slice(group.indexOf('>') + 1, group.indexOf('</div>'));
    expect(inside.startsWith('<button')).toBe(true);
    expect(inside.endsWith('</button>')).toBe(true);
  });

  it('puts exactly one of them on', () => {
    // an empty answer is not an answer here — every dimension on the plan is
    // measured from somewhere
    for (const mode of ['outside', 'inside'] as const) {
      const group = groupAt(panel(mode), 0);
      expect(group.match(/aria-checked="true"/g)).toHaveLength(1);
      expect(group.match(/aria-checked="false"/g)).toHaveLength(1);
    }
  });

  it('answers the length question on its own, one option on', () => {
    for (const reach of ['linked', 'alone'] as const) {
      const group = groupAt(panel('outside', reach), 1);
      expect(group.match(/aria-checked="true"/g)).toHaveLength(1);
      expect(group.match(/aria-checked="false"/g)).toHaveLength(1);
    }
  });

  it('shows which way a typed length reaches', () => {
    // the guard against a control wired for reading but rendering the same
    // either way, which looks live and is not
    expect(groupAt(panel('outside', 'linked'), 1)).not.toEqual(
      groupAt(panel('outside', 'alone'), 1),
    );
  });

  it('keeps the two questions independent', () => {
    // they are settings that happen to share a sheet, not one setting with
    // four positions
    const html = panel('inside', 'alone');
    expect(groupAt(html, 0)).toContain('Inside');
    expect(groupAt(html, 1)).toContain('This wall only');
  });

  it('leaves connected walls following until told otherwise', () => {
    // a setting must not change the drawing the moment it exists
    expect(new EditorUi().resizeReach.get()).toBe('linked');
  });

  it('renders differently in the two modes at all', () => {
    // the guard against a control that is wired to the store for reading but
    // renders the same either way — which would look like a dead button
    expect(panel('outside')).not.toBe(panel('inside'));
  });
});
