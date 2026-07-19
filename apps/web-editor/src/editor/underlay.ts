import type { EditorSession, Point } from '@acip/editor-core';
import type { ImageBlock } from '@acip/agent-drafter';
import type { EditorUi, UnderlayState } from './ui-state';
import { runDrafter } from './agent';

/** longest crop side sent to the model — plans stay readable, payloads small */
const MAX_CROP_PIXELS = 1200;

/** initial width the loaded plan spans on screen, in meters, centered on origin */
const DEFAULT_WORLD_WIDTH = 20;

export function loadUnderlayFromFile(file: File, ui: EditorUi): void {
  const reader = new FileReader();
  reader.onload = () => {
    const image = new Image();
    image.onload = () => {
      const scale = DEFAULT_WORLD_WIDTH / image.width;
      ui.underlay.set({
        image,
        scale,
        anchor: {
          x: -DEFAULT_WORLD_WIDTH / 2,
          y: (image.height * scale) / 2,
        },
        opacity: 0.6,
      });
      ui.appendLog(
        'Underlay loaded. Calibrate: click two points a known distance apart.',
      );
    };
    image.src = String(reader.result ?? '');
  };
  reader.readAsDataURL(file);
}

/**
 * Two-point calibration: the segment a→b on screen really measures
 * realDistance meters. Rescales around a, so the first clicked point stays
 * put while the rest of the image stretches to true size.
 */
export function calibrateUnderlay(
  underlay: UnderlayState,
  a: Point,
  b: Point,
  realDistance: number,
): UnderlayState {
  const measured = Math.hypot(b.x - a.x, b.y - a.y);
  if (measured < 1e-9 || realDistance <= 0) return underlay;
  const factor = realDistance / measured;
  return {
    ...underlay,
    scale: underlay.scale * factor,
    anchor: {
      x: a.x + (underlay.anchor.x - a.x) * factor,
      y: a.y + (underlay.anchor.y - a.y) * factor,
    },
  };
}

interface CropResult {
  readonly block: ImageBlock;
  /** world rect of what was actually cropped (clamped to the image) */
  readonly topLeft: Point;
  readonly widthM: number;
  readonly heightM: number;
}

/** cut the world rectangle a…b out of the underlay as a base64 PNG block */
export function cropUnderlay(
  underlay: UnderlayState,
  a: Point,
  b: Point,
): CropResult | null {
  const { image, anchor, scale } = underlay;
  // world rect → image pixel rect (image y runs opposite to world y)
  const px = (wx: number) => (wx - anchor.x) / scale;
  const py = (wy: number) => (anchor.y - wy) / scale;
  const sx0 = Math.max(0, Math.min(px(a.x), px(b.x)));
  const sx1 = Math.min(image.width, Math.max(px(a.x), px(b.x)));
  const sy0 = Math.max(0, Math.min(py(a.y), py(b.y)));
  const sy1 = Math.min(image.height, Math.max(py(a.y), py(b.y)));
  const sw = sx1 - sx0;
  const sh = sy1 - sy0;
  if (sw < 8 || sh < 8) return null;

  const shrink = Math.min(1, MAX_CROP_PIXELS / Math.max(sw, sh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(sw * shrink));
  canvas.height = Math.max(1, Math.round(sh * shrink));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(image, sx0, sy0, sw, sh, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/png');
  const comma = dataUrl.indexOf(',');
  return {
    block: {
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: dataUrl.slice(comma + 1),
      },
    },
    topLeft: { x: anchor.x + sx0 * scale, y: anchor.y - sy0 * scale },
    widthM: sw * scale,
    heightM: sh * scale,
  };
}

/** crop the selected region and hand it to the drafter to trace into the model */
export function traceRegion(
  session: EditorSession,
  ui: EditorUi,
  a: Point,
  b: Point,
): void {
  const underlay = ui.underlay.get();
  if (!underlay) {
    ui.appendLog('Load an underlay before tracing.', 'error');
    return;
  }
  const crop = cropUnderlay(underlay, a, b);
  if (!crop) {
    ui.appendLog('The selection does not cover the underlay.', 'error');
    return;
  }
  const f = (v: number) => v.toFixed(2);
  const prompt =
    `Trace the attached plan crop into the model. Placement: the crop's ` +
    `top-left corner is at world (${f(crop.topLeft.x)}, ${f(crop.topLeft.y)}) m; ` +
    `the crop spans ${f(crop.widthM)} m wide by ${f(crop.heightM)} m tall ` +
    `(+x right, +y up — the image's downward direction is -y). ` +
    `Draw the walls you can see with WALL_ADD at true world coordinates, ` +
    `as closed rooms with exactly shared endpoints where they join. Add the ` +
    `doors and windows you can identify. State the overall dimensions you ` +
    `assumed so the user can correct them.`;

  ui.agentMode.set('drafter');
  ui.agentChatOpen.set(true);
  ui.showMarks.set(true);
  void runDrafter(session, ui, prompt, [crop.block]);
}
