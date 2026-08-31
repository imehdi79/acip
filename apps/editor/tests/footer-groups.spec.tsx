import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, ButtonGroup } from '@heroui/react';
import { EditorSession } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import { DangerZone } from '@/app/components/layout/footer/danger-zone';
import { Modes } from '@/app/components/layout/footer/modes';
import { Floors } from '@/app/components/layout/footer/floors';
import { FOOTER_ITEMS } from '@/app/components/layout/footer/actions';
import { enterDangerZone } from '@/editor/danger-zone';
import type { User } from '@/app/stores/global/settings.store';

/**
 * A footer run has to read as ONE control, and that is decided by the DOM, not
 * by the descriptors: the joined look comes from CSS —
 *
 *   .button-group .button              { border-radius: 0 }
 *   .button-group--horizontal .button:first-child { …rounded left }
 *   .button-group--horizontal .button:last-child  { …rounded right }
 *
 * `:first-child` and `:last-child` are relative to each button's OWN parent, so
 * anything wrapping a button — a div for animation, a Fragment carrying a
 * cloned prop, a component that renders a container — turns it into an only
 * child and it comes out as a loose, fully rounded pill. That has already
 * happened twice in this bar.
 *
 * The risky part of this run is everything that is not a plain Button: Modes
 * returns several children at once, a live mode arrives through a component of
 * its own, and the estimator arrives through a Modal. None of them may put a
 * node in the way.
 */
describe('the session run renders as one joined group', () => {
  const editor: User = { id: 'e', name: 'Editor', role: 'editor' };
  const guest: User = { id: 'g', name: 'Guest', role: 'guest' };

  /** the bar's left as the footer really composes it */
  const run = (session: EditorSession, user: User) => {
    const runtime = createRuntime(session);
    const html = renderToStaticMarkup(
      <ButtonGroup>
        <Button isIconOnly aria-label="Undo" variant="tertiary">
          U
        </Button>
        <Button isIconOnly aria-label="Redo" variant="tertiary">
          R
        </Button>
        <Modes
          session={session}
          ui={runtime.ui}
          tools={runtime.tools}
          user={user}
        />
      </ButtonGroup>,
    );
    return {
      runtime,
      /** everything between the group element's own tags */
      inside: html.slice(
        html.indexOf('>', html.indexOf('data-slot="button-group"')) + 1,
        html.lastIndexOf('</div>'),
      ),
    };
  };

  it('puts every button directly inside the group element', () => {
    const { inside } = run(new EditorSession(), editor);
    expect(inside.startsWith('<button')).toBe(true); // :first-child
    expect(inside.endsWith('</button>')).toBe(true); // :last-child
    // undo, redo, and the modes menu — nothing is live yet
    expect(inside.match(/data-slot="button"/g)).toHaveLength(3);
  });

  it('wraps none of them in a container of its own', () => {
    const { inside } = run(new EditorSession(), editor);
    // Modes returns several children through a Fragment, and a modal trigger
    // could render a box: either would make a button an only child, and an
    // only child is a fully rounded pill instead of part of the run
    expect(inside).not.toContain('<div');
    expect(inside).not.toContain('data-slot="modal-trigger"');
  });

  it('stands a live mode next to undo/redo, still in the run', () => {
    // the whole point of folding the modes away: one that is ON comes back out
    const session = new EditorSession();
    const { runtime } = run(session, editor);
    enterDangerZone(session, runtime.ui);
    const { inside } = (() => {
      const html = renderToStaticMarkup(
        <ButtonGroup>
          <Button isIconOnly aria-label="Undo" variant="tertiary">
            U
          </Button>
          <Modes
            session={session}
            ui={runtime.ui}
            tools={runtime.tools}
            user={editor}
          />
        </ButtonGroup>,
      );
      return {
        inside: html.slice(
          html.indexOf('>', html.indexOf('data-slot="button-group"')) + 1,
          html.lastIndexOf('</div>'),
        ),
      };
    })();

    expect(inside).toContain('aria-label="Leave the danger zone"');
    expect(inside).toContain('button--danger');
    // undo + the surfaced zone + the menu, all still direct children
    expect(inside.match(/data-slot="button"/g)).toHaveLength(3);
    expect(inside).not.toContain('<div');
  });

  it('offers a guest no menu at all', () => {
    // the descriptor is ungated so a mode can always be left; what it HOLDS is
    // gated item by item, and a user who may use none of it gets no button
    const { inside } = run(new EditorSession(), guest);
    expect(inside.match(/data-slot="button"/g)).toHaveLength(2); // undo, redo
    expect(inside).not.toContain('aria-label="Modes"');
  });

  it('carries the mode in red rather than in a word', () => {
    /*
     * The label was ~110 px of a ~360 px phone, and opening the zone ADDS this
     * button to a row already holding the session run, the tools and whatever
     * a selection brought — so the one control that announced the mode was
     * also the one pushing the row's ends off the screen. It used to give the
     * word up only under a selection, which meant the bar overflowed whenever
     * there was not one.
     */
    const zone = new EditorSession();
    const rt = createRuntime(zone);
    enterDangerZone(zone, rt.ui);
    const html = renderToStaticMarkup(<DangerZone session={zone} ui={rt.ui} />);

    expect(html).not.toContain('Danger zone<');
    expect(html).toContain('button--icon-only');
    // what actually says you are in it: pressed, and solid red against a bar
    // of muted icons
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('button--danger');
    // and never unannounced, only unwritten
    expect(html).toContain('aria-label="Leave the danger zone"');
  });

  it('is not red until the zone is actually open', () => {
    // the colour is the whole signal now, so it must not be on at rest
    const quiet = new EditorSession();
    const rt = createRuntime(quiet);
    const html = renderToStaticMarkup(
      <DangerZone session={quiet} ui={rt.ui} />,
    );
    expect(html).not.toContain('button--danger');
    expect(html).toContain('aria-pressed="false"');
  });

  it('gives every icon in the run the same weight', () => {
    // the bar's icons carry the whole meaning, so they read solid rather than
    // muted — a button that skipped it would be the faint one in the row
    const { inside } = run(new EditorSession(), editor);
    const tags = inside.match(/<button[^>]*>/g) ?? [];
    expect(tags).toHaveLength(3);
    expect(tags[2]).toContain('text-foreground'); // the modes menu
  });
});

/**
 * The bar shows icons and nothing else.
 *
 * A label is ~110 px of a ~360 px phone. One is affordable and four are not,
 * and any rule that keeps SOME words is a rule about which button matters
 * most — which is a different answer on every screen, and was the rule that
 * let the row push its own ends out of view whenever the danger zone was open
 * and nothing was selected.
 */
describe('the bar is icons and nothing else', () => {
  const editorUser: User = { id: 'e', name: 'Editor', role: 'editor' };

  it('renders every custom footer button icon-only', () => {
    const session = new EditorSession();
    const rt = createRuntime(session);
    const buttons = [
      renderToStaticMarkup(
        <Modes
          session={session}
          ui={rt.ui}
          tools={rt.tools}
          user={editorUser}
        />,
      ),
      renderToStaticMarkup(
        <Floors session={session} ui={rt.ui} user={editorUser} />,
      ),
      renderToStaticMarkup(<DangerZone session={session} ui={rt.ui} />),
    ];
    for (const html of buttons) {
      expect(html).toContain('button--icon-only');
    }
  });

  it('still says what each one is, for anyone not looking at it', () => {
    // the words did not disappear, they moved to where a screen reader reads
    // them — an icon-only bar with no labels is a bar nobody else can use
    const session = new EditorSession();
    const rt = createRuntime(session);
    const html = renderToStaticMarkup(
      <Floors session={session} ui={rt.ui} user={editorUser} />,
    );
    expect(html).toMatch(/aria-label="Floors[^"]*"/);
  });

  it('leaves no footer item asking for a label of its own', () => {
    // the flag is gone from the descriptor: icon-only is a property of the
    // BAR, not a choice each button gets to make
    for (const item of FOOTER_ITEMS) {
      expect(item).not.toHaveProperty('iconOnly');
      // and every one still carries the words a screen reader needs
      expect(item.label.trim()).toBeTruthy();
    }
  });
});
