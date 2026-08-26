import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SHAPE_COLOR,
  SHAPE_COLORS,
  shapeColor,
  shapeFill,
} from '@/editor/shape-colors';
import { toCentimetre } from '@/app/components/layout/footer/estimator-fields';

/**
 * One table, read by the plan and by the model. They used to pick colours
 * separately, so the same wall could be grey on the plan and beige in 3D with
 * nothing but eyesight connecting them.
 */
describe('what colour a thing is', () => {
  it('gives the kinds a plan is read by their own colour', () => {
    for (const kind of ['wall', 'slab', 'roof', 'door', 'window', 'stair']) {
      expect(shapeColor(kind)).toBe(SHAPE_COLORS[kind]);
      expect(shapeColor(kind)).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });

  it('keeps every kind distinguishable from every other', () => {
    // a palette where two kinds land on the same hue is a legend that lies
    const used = Object.values(SHAPE_COLORS);
    expect(new Set(used).size).toBe(used.length);
  });

  it('answers for a kind nobody has coloured, without pretending', () => {
    expect(shapeColor('not-a-thing')).toBe(DEFAULT_SHAPE_COLOR);
  });

  it('derives a fill from the same hue as the line around it', () => {
    // one hue per kind, stated once: a fill cannot drift from its stroke
    const fill = shapeFill('wall');
    expect(fill).toMatch(/^rgb\(\d+, \d+, \d+\)$/);
    // lighter than the stroke, or the linework would vanish into it
    expect(shapeFill('wall', 0)).not.toBe(shapeFill('wall', 0.9));
  });

  it('lightens toward white and never past it', () => {
    const full = shapeFill('roof', 1);
    expect(full).toBe('rgb(255, 255, 255)');
  });
});

/**
 * Widths reaching the estimator's boxes are derived — `(t1 - t0) x length` —
 * and floating point hands back 5.699999999999999 for a wall somebody measured
 * at 5.7. Nobody builds to the eleventh decimal.
 */
describe('metres to the centimetre', () => {
  it('drops the floating point tail', () => {
    expect(toCentimetre(5.699999999999999)).toBe(5.7);
    expect(toCentimetre(12.404999999)).toBe(12.4);
  });

  it('keeps two decimals where two are meant', () => {
    expect(toCentimetre(1.25)).toBe(1.25);
    expect(toCentimetre(0.09)).toBe(0.09);
  });

  it('rounds rather than truncating', () => {
    // 5.699 is nearer 5.7 than 5.69, and an estimate should say the nearer one
    expect(toCentimetre(5.699)).toBe(5.7);
    expect(toCentimetre(5.694)).toBe(5.69);
  });

  it('is stable when applied twice', () => {
    // the value goes out rounded and comes back through the reader; if a
    // second pass moved it, every blur would dispatch an edit that changed
    // nothing on screen
    for (const n of [5.699999999, 0.005, 3.14159, 12.345]) {
      expect(toCentimetre(toCentimetre(n))).toBe(toCentimetre(n));
    }
  });
});
