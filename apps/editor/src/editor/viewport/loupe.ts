import type { DrawingDocument, ViewDefinition } from '@acip/editor-core';
import { Viewport2D } from './viewport2d';
import { drawOverlay, drawPlanDimensions, drawScene } from './scene-renderer';
import type { MeasureMode, OverlayState, UnderlayState } from '../ui-state';

/**
 * How wide the glass is, in CSS pixels. Big enough to read a junction in and
 * small enough to leave the plan behind it legible — a loupe that covered a
 * third of the screen would be trading one blind spot for another.
 */
export const LOUPE_SIZE = 112;

/** how much closer it looks than the plan does */
export const LOUPE_MAGNIFY = 2.5;

/** the gap it keeps from the footer and from the edges of the plan */
const MARGIN = 12;

/**
 * The finger hides the one point the user is aiming at.
 *
 * That is the whole problem: a fingertip covers roughly a centimetre of glass,
 * and the thing being placed — a wall's endpoint, the grip being dragged, the
 * node being snapped to — is underneath it. On a mouse the cursor is a few
 * pixels beside the point; on a phone the point is simply gone, and the user
 * is aiming from memory.
 *
 * So the plan is drawn a SECOND time, magnified, somewhere the finger is not.
 * Not a screenshot of the first drawing scaled up — that would be the same
 * pixels, larger and blurrier, and a snapped endpoint half a pixel wide would
 * still be half a pixel of mush. It is the real scene, re-rendered at a closer
 * zoom through the same `drawScene` the viewport uses, so linework, marks,
 * dimensions and the live rubber band all come out crisp and all come out
 * CURRENT.
 *
 * Two canvases, because the overlay clears itself: `drawOverlay` starts with a
 * `clearRect`, so the scene and the rubber band over it cannot share one
 * surface. The main viewport stacks them for exactly this reason, and the
 * glass mirrors it rather than inventing a different arrangement.
 *
 * It draws nothing about interaction and decides nothing about it. Everything
 * here reads: the document, the camera, the overlay state. A tool cannot tell
 * whether the loupe is up.
 */
export interface LoupeSurfaces {
  /** the round frame that is shown and hidden and moved */
  readonly frame: HTMLElement;
  readonly base: HTMLCanvasElement;
  readonly overlay: HTMLCanvasElement;
}

/** everything the glass needs to re-render the plan, exactly as the view does */
export interface LoupeScene {
  readonly doc: DrawingDocument;
  readonly view: ViewDefinition;
  readonly selection: ReadonlySet<string>;
  readonly showMarks: boolean;
  readonly underlay: UnderlayState | null;
  readonly showDemolition: boolean;
  readonly measureMode: MeasureMode;
  readonly overlay: OverlayState;
}

/**
 * The camera for the glass: the same world, seen closer, centred on the point
 * under the finger.
 *
 * A fresh Viewport2D rather than a mutated copy of the live one — the plan
 * must not move because somebody looked at it through the glass, and sharing
 * the instance is the one way that could happen.
 *
 * Exported because this is the arithmetic worth checking: hand it a screen
 * point and the answer is a camera under which that exact point lands in the
 * middle of the glass.
 */
export function loupeCamera(
  from: Viewport2D,
  screen: { x: number; y: number },
  size = LOUPE_SIZE,
  magnify = LOUPE_MAGNIFY,
): Viewport2D {
  const camera = new Viewport2D();
  const focus = from.toWorld(screen.x, screen.y);
  camera.scale = from.scale * magnify;
  // world is Y-up and screen is Y-down, which is why the y term adds where the
  // x term subtracts — the same flip `toScreen` carries
  camera.offsetX = size / 2 - focus.x * camera.scale;
  camera.offsetY = size / 2 + focus.y * camera.scale;
  return camera;
}

/**
 * Where the glass sits, given where the finger is.
 *
 * Above the footer always, because that is the one band of the screen a thumb
 * reaching the plan is not already in. Left or right by which half the finger
 * is in, so the glass is on the far side of the screen FROM the hand holding
 * it — a loupe under the finger would be showing the user their own knuckle.
 *
 * In CSS pixels within the viewport box, as a `left`/`top` pair.
 */
export function loupePlacement(
  finger: { x: number; y: number },
  box: { width: number; height: number },
  footer: number,
  size = LOUPE_SIZE,
): { left: number; top: number } {
  const onLeftHalf = finger.x < box.width / 2;
  return {
    // opposite side to the finger
    left: onLeftHalf ? box.width - size - MARGIN : MARGIN,
    // clear of the footer, and never off the top of a very short viewport
    top: Math.max(MARGIN, box.height - footer - size - MARGIN),
  };
}

/** size both canvases for the device, once — the glass never changes size */
export function sizeLoupe(surfaces: LoupeSurfaces, size = LOUPE_SIZE): void {
  const dpr = window.devicePixelRatio || 1;
  for (const canvas of [surfaces.base, surfaces.overlay]) {
    canvas.width = Math.max(1, Math.round(size * dpr));
    canvas.height = Math.max(1, Math.round(size * dpr));
    canvas.style.width = `${size}px`;
    canvas.style.height = `${size}px`;
  }
}

/**
 * Draw the plan into the glass, at the point under the finger.
 *
 * Every draw goes through the same renderers the viewport uses, so anything
 * that becomes visible on the plan becomes visible in here for free — that is
 * the point of re-rendering rather than magnifying pixels.
 */
export function paintLoupe(
  surfaces: LoupeSurfaces,
  from: Viewport2D,
  finger: { x: number; y: number },
  scene: LoupeScene,
): void {
  const camera = loupeCamera(from, finger);
  drawScene(
    surfaces.base,
    camera,
    scene.doc,
    scene.view,
    scene.selection,
    scene.showMarks,
    scene.underlay,
    scene.showDemolition,
  );
  drawPlanDimensions(
    surfaces.base,
    camera,
    scene.doc,
    scene.view,
    scene.selection,
    scene.measureMode,
  );
  // the rubber band, the snap marker, the thing actually being placed — the
  // whole reason somebody looks at the glass while drawing
  drawOverlay(surfaces.overlay, camera, scene.overlay);
}
