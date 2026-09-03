import { describe, expect, it } from 'vitest';
import { Viewport2D } from '@/editor/viewport/viewport2d';
import {
  LOUPE_MAGNIFY,
  LOUPE_SIZE,
  loupeCamera,
  loupePlacement,
} from '@/editor/viewport/loupe';

/**
 * The finger hides the one point the user is aiming at. The glass draws the
 * plan a second time, closer, somewhere the finger is not — so the two things
 * worth checking are that it is looking at the right place and that it is not
 * standing in the way.
 */
describe('what the glass is looking at', () => {
  const plan = () => {
    const v = new Viewport2D();
    v.scale = 60;
    v.offsetX = 200;
    v.offsetY = 400;
    return v;
  };

  it('puts the point under the finger in the middle of the glass', () => {
    // the whole contract: whatever the finger is on is what is magnified
    const from = plan();
    const finger = { x: 137, y: 289 };
    const camera = loupeCamera(from, finger);

    const world = from.toWorld(finger.x, finger.y);
    const inGlass = camera.toScreen(world);
    expect(inGlass.x).toBeCloseTo(LOUPE_SIZE / 2, 9);
    expect(inGlass.y).toBeCloseTo(LOUPE_SIZE / 2, 9);
  });

  it('holds for any point on the plan, not just a lucky one', () => {
    const from = plan();
    for (const finger of [
      { x: 0, y: 0 },
      { x: 359, y: 12 },
      { x: 12, y: 640 },
      { x: 180.5, y: 333.25 },
    ]) {
      const camera = loupeCamera(from, finger);
      const inGlass = camera.toScreen(from.toWorld(finger.x, finger.y));
      expect(inGlass.x).toBeCloseTo(LOUPE_SIZE / 2, 9);
      expect(inGlass.y).toBeCloseTo(LOUPE_SIZE / 2, 9);
    }
  });

  it('actually magnifies, rather than merely re-centring', () => {
    const from = plan();
    const camera = loupeCamera(from, { x: 100, y: 100 });
    expect(camera.scale).toBeCloseTo(from.scale * LOUPE_MAGNIFY, 9);
    expect(LOUPE_MAGNIFY).toBeGreaterThan(1);
  });

  it('follows the plan when the plan is zoomed', () => {
    // a loupe pinned to an absolute scale would be a magnifier at one zoom and
    // a minifier at another
    const near = plan();
    near.scale = 300;
    expect(loupeCamera(near, { x: 50, y: 50 }).scale).toBeCloseTo(
      300 * LOUPE_MAGNIFY,
      9,
    );
  });

  it('leaves the drawing camera untouched', () => {
    // looking through the glass must not move the drawing
    const from = plan();
    const before = { s: from.scale, x: from.offsetX, y: from.offsetY };
    loupeCamera(from, { x: 77, y: 88 });
    expect(from.scale).toBe(before.s);
    expect(from.offsetX).toBe(before.x);
    expect(from.offsetY).toBe(before.y);
  });
});

describe('where the glass stands', () => {
  const box = { width: 360, height: 740 };
  const FOOTER = 64;

  it('goes to the far side from the finger', () => {
    // a loupe under the finger would be showing the user their own knuckle
    const left = loupePlacement({ x: 40, y: 600 }, box, FOOTER);
    const right = loupePlacement({ x: 320, y: 600 }, box, FOOTER);
    expect(left.left).toBeGreaterThan(box.width / 2);
    expect(right.left).toBeLessThan(box.width / 2);
  });

  it('never overlaps the finger, wherever the finger is', () => {
    // the property that matters, checked rather than reasoned about
    for (let x = 0; x <= box.width; x += 10) {
      for (const y of [200, 500, 700, box.height]) {
        const at = loupePlacement({ x, y }, box, FOOTER);
        const covers =
          x >= at.left &&
          x <= at.left + LOUPE_SIZE &&
          y >= at.top &&
          y <= at.top + LOUPE_SIZE;
        expect(covers).toBe(false);
      }
    }
  });

  it('stays clear of the footer', () => {
    const at = loupePlacement({ x: 40, y: 300 }, box, FOOTER);
    expect(at.top + LOUPE_SIZE).toBeLessThanOrEqual(box.height - FOOTER);
  });

  it('stays on screen even in a viewport too short to hold it', () => {
    // a phone in landscape with the keyboard up; better squeezed than gone
    const at = loupePlacement(
      { x: 40, y: 60 },
      { width: 360, height: 120 },
      FOOTER,
    );
    expect(at.top).toBeGreaterThanOrEqual(0);
    expect(at.left).toBeGreaterThanOrEqual(0);
    expect(at.left + LOUPE_SIZE).toBeLessThanOrEqual(360);
  });
});
