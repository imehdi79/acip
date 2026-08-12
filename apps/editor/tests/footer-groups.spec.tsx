import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, ButtonGroup } from '@heroui/react';
import { EditorSession } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import { DangerZone } from '@/app/components/layout/footer/danger-zone';
import { Modes } from '@/app/components/layout/footer/modes';
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

  it('keeps the mode red but drops its label when the bar is busy', () => {
    // ~110 px of a ~360 px phone, spent exactly when a selection has added its
    // own run of buttons: the red is the mode, the word is the reinforcement
    const zone = new EditorSession();
    const rt = createRuntime(zone);
    enterDangerZone(zone, rt.ui);

    const roomy = renderToStaticMarkup(
      <DangerZone session={zone} ui={rt.ui} />,
    );
    const busy = renderToStaticMarkup(
      <DangerZone session={zone} ui={rt.ui} compact />,
    );

    expect(roomy).toContain('Danger zone<');
    expect(busy).not.toContain('Danger zone<');
    // both still read as the mode: pressed, and in the danger variant
    for (const html of [roomy, busy]) {
      expect(html).toContain('aria-pressed="true"');
      expect(html).toContain('button--danger');
    }
    expect(busy).toContain('button--icon-only');
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
