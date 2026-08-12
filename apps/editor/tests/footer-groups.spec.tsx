import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Button, ButtonGroup } from '@heroui/react';
import { EditorSession } from '@acip/editor-core';
import { createRuntime } from '@/editor/runtime';
import { DangerZone } from '@/app/components/layout/footer/danger-zone';
import { Estimator } from '@/app/components/layout/footer/estimator';
import { enterDangerZone } from '@/editor/danger-zone';

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
 * The two buttons in the session run that are not plain Buttons are the ones
 * at risk: DangerZone goes through a component, and Estimator goes through a
 * Modal. Neither may put a node in the way.
 */
describe('the session run renders as one joined group', () => {
  const session = new EditorSession();
  const runtime = createRuntime(session);

  const html = renderToStaticMarkup(
    <ButtonGroup>
      <Button isIconOnly aria-label="Undo" variant="tertiary">
        U
      </Button>
      <Button isIconOnly aria-label="Redo" variant="tertiary">
        R
      </Button>
      <DangerZone session={session} ui={runtime.ui} />
      <Estimator />
    </ButtonGroup>,
  );

  /** everything between the group element's own tags */
  const inside = html.slice(
    html.indexOf('>', html.indexOf('data-slot="button-group"')) + 1,
    html.lastIndexOf('</div>'),
  );

  it('puts every button directly inside the group element', () => {
    expect(inside.startsWith('<button')).toBe(true); // :first-child
    expect(inside.endsWith('</button>')).toBe(true); // :last-child
    expect(inside.match(/data-slot="button"/g)).toHaveLength(4);
  });

  it('wraps none of them in a container of its own', () => {
    // a modal trigger that rendered a box, or a Fragment turned into one
    expect(inside).not.toContain('<div');
    expect(inside).not.toContain('data-slot="modal-trigger"');
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
    // muted — a button that skipped it would be the faint one in a row of four
    const tags = inside.match(/<button[^>]*>/g) ?? [];
    expect(tags).toHaveLength(4);
    for (const tag of tags.slice(2)) {
      expect(tag).toContain('text-foreground');
    }
  });
});
