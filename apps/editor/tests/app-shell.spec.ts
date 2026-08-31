import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import MainWrapper from '@/app/components/layout/wrapper/MainWrapper';

/**
 * The shell's height is the reason the header and footer exist on screen at
 * all, and it has been got wrong twice in two different ways — both of them
 * invisible in the source and visible only in the built stylesheet. So the
 * BUILT file is what is asserted here, not the authored one.
 */
const css = () =>
  readFileSync(resolve(__dirname, '../src/app/app.css'), 'utf8');
const html = () => readFileSync(resolve(__dirname, '../index.html'), 'utf8');

describe('the app shell has a height on every iPhone', () => {
  it('states a vh height that any browser understands', () => {
    // the floor. Without it, an iOS that predates dvh gets no height at all,
    // the panel collapses to its content, and `bottom-0` stops being the
    // bottom of the screen — which is how the chrome went missing
    expect(css()).toMatch(/\.app-shell\s*\{[^}]*min-height:\s*100vh/);
  });

  it('upgrades to dvh only where dvh is understood', () => {
    // @supports rather than two declarations in one rule: Lightning CSS
    // minifies the redundant-looking first declaration away, and the fallback
    // has to survive the build to be a fallback
    expect(css()).toMatch(
      /@supports\s*\(min-height:\s*100dvh\)[\s\S]*\.app-shell[\s\S]*min-height:\s*100dvh/,
    );
  });

  it('says its height in one class, not in two utilities', () => {
    /*
     * `min-h-screen min-h-dvh` reads like a fallback and is not one: the order
     * of names in a class attribute changes nothing, and Tailwind emits
     * `.min-h-screen` after `.min-h-dvh`, so every browser that understood
     * both took the vh — the one unit that ignores Safari's toolbar.
     *
     * Asserted on the RENDERED markup rather than the source, because the
     * source explains that mistake in prose and a grep cannot tell an
     * explanation from a reoccurrence.
     */
    const markup = renderToStaticMarkup(
      MainWrapper({ children: null }) as ReactElement,
    );
    expect(markup).toContain('app-shell');
    expect(markup).not.toContain('min-h-dvh');
    expect(markup).not.toContain('min-h-screen');
  });

  it('does not ask a child for a percentage of a height nobody set', () => {
    // min-h-full resolves against the PARENT'S HEIGHT, and the parent has only
    // a min-height — so it resolved against auto and collapsed, taking the
    // absolutely positioned chrome with it. The panel is a flex child and
    // stretches on the cross axis instead, which needs no percentage at all.
    const markup = renderToStaticMarkup(
      MainWrapper({ children: null }) as ReactElement,
    );
    expect(markup).not.toContain('min-h-full');
  });

  it('opts into the safe areas it then pads for', () => {
    // env(safe-area-inset-*) reports zero without viewport-fit=cover, so the
    // padding on the header and footer would be padding by nothing
    expect(html()).toMatch(/viewport-fit=cover/);
  });

  it('keeps the chrome clear of the notch and the home indicator', () => {
    const header = readFileSync(
      resolve(__dirname, '../src/app/components/layout/header/index.tsx'),
      'utf8',
    );
    const footer = readFileSync(
      resolve(__dirname, '../src/app/components/layout/footer/index.tsx'),
      'utf8',
    );
    expect(header).toContain('env(safe-area-inset-top)');
    expect(footer).toContain('env(safe-area-inset-bottom)');
    // min-h, not h: the inset has to ADD to the bar, or a notched phone eats
    // the touch target rather than moving it
    expect(header).toContain('min-h-14');
    expect(footer).toContain('min-h-14');
  });
});
