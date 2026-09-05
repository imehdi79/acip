import { useEffect, useRef } from 'react';
import type { InputModifiers, Point, ViewDefinition } from '@acip/editor-core';
import { isEntityVisible } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import {
  LOUPE_SIZE,
  loupePlacement,
  paintLoupe,
  sizeLoupe,
  type LoupeSurfaces,
} from './loupe';
import { Viewport2D } from './viewport2d';
import {
  drawOverlay,
  drawPlanDimensions,
  drawScene,
  overlayAnimates,
} from './scene-renderer';
import { lengthUnit } from '../units';
import { magneticSnap, touchSnapOptions } from '../snap-policy';

const PICK_PIXELS = 8;
const SNAP_PIXELS = 10;
/* fingers are blunter than cursors: wider pick/snap radii, and a movement
   budget below which a touch still counts as a tap rather than a pan */
const TOUCH_PICK_PIXELS = 20;
const TAP_SLOP_PIXELS = 8;
/* the band at the bottom the footer sits over, which the loupe stays clear of
   so it never covers the bar it is trying not to be in the way of */
const FOOTER_PIXELS = 64;

function modifiersOf(e: PointerEvent): InputModifiers {
  return { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey };
}

/**
 * Imperative island: subscribes directly to document/selection/camera/overlay
 * changes and redraws on rAF. React renders this component exactly once.
 */
export function Viewport2DView() {
  const session = useSession();
  const { ui, tools } = useRuntime();
  const containerRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const loupeRef = useRef<HTMLDivElement>(null);
  const loupeBaseRef = useRef<HTMLCanvasElement>(null);
  const loupeOverlayRef = useRef<HTMLCanvasElement>(null);
  const viewportRef = useRef<Viewport2D | null>(null);
  if (!viewportRef.current) viewportRef.current = new Viewport2D();

  useEffect(() => {
    const container = containerRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    const viewport = viewportRef.current;
    const loupeFrame = loupeRef.current;
    const loupeBase = loupeBaseRef.current;
    const loupeOverlay = loupeOverlayRef.current;
    if (!container || !base || !overlay || !viewport) return;
    if (!loupeFrame || !loupeBase || !loupeOverlay) return;
    const loupe: LoupeSurfaces = {
      frame: loupeFrame,
      base: loupeBase,
      overlay: loupeOverlay,
    };
    sizeLoupe(loupe);

    let baseRaf = 0;
    const planView = (): ViewDefinition => ({
      kind: 'plan',
      levelId: ui.activeLevelId.get(),
    });
    const redrawBase = () => {
      cancelAnimationFrame(baseRaf);
      baseRaf = requestAnimationFrame(() => {
        const selected = new Set(session.selection.list());
        drawScene(
          base,
          viewport,
          session.doc,
          planView(),
          selected,
          ui.showMarks.get(),
          ui.underlay.get(),
          ui.showDemolition.get(),
        );
        // wall lengths and opening widths, always on — same canvas, drawn over
        // the finished scene
        drawPlanDimensions(
          base,
          viewport,
          session.doc,
          planView(),
          selected,
          ui.measureMode.get(),
        );
      });
    };
    const redrawOverlay = () =>
      drawOverlay(overlay, viewport, ui.overlay.get());

    /* the pending wall pulses, which is the one thing here that needs a clock
       rather than an event. The loop runs only while it is on screen. */
    let blinkRaf = 0;
    const blink = () => {
      if (!overlayAnimates(ui.overlay.get())) {
        blinkRaf = 0;
        return;
      }
      redrawOverlay();
      blinkRaf = requestAnimationFrame(blink);
    };
    const syncBlink = () => {
      if (blinkRaf === 0 && overlayAnimates(ui.overlay.get())) blink();
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      const { clientWidth, clientHeight } = container;
      for (const canvas of [base, overlay]) {
        canvas.width = Math.max(1, Math.round(clientWidth * dpr));
        canvas.height = Math.max(1, Math.round(clientHeight * dpr));
      }
      viewport.centerIfUnset(clientWidth, clientHeight);
      redrawBase();
      redrawOverlay();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);

    /* last-used input width: mouse taps and finger taps pick with different radii */
    let pickPixels = PICK_PIXELS;
    const unsubs = [
      session.doc.events.on('change', redrawBase),
      session.selection.events.on('changed', redrawBase),
      viewport.subscribe(() => {
        tools.worldTolerance = pickPixels / viewport.scale;
        ui.camera.set({
          scale: viewport.scale,
          offsetX: viewport.offsetX,
          offsetY: viewport.offsetY,
        });
        redrawBase();
        redrawOverlay();
      }),
      ui.overlay.subscribe(() => {
        redrawOverlay();
        syncBlink();
      }),
      ui.activeLevelId.subscribe(redrawBase),
      ui.showMarks.subscribe(redrawBase),
      ui.showDemolition.subscribe(redrawBase),
      ui.underlay.subscribe(redrawBase),
      // dimensions are rendered in the active unit, so redraw when it changes
      lengthUnit.subscribe(redrawBase),
      // and against the chosen face — inside/outside is read at draw time, so
      // without this the toggle would sit there doing nothing until the next
      // edit happened to redraw the canvas
      ui.measureMode.subscribe(redrawBase),
      ui.fitTick.subscribe(() => {
        const w = container.clientWidth;
        const h = container.clientHeight;
        const target = ui.fitTarget.get();
        if (target) {
          viewport.fit(
            target.minX,
            target.minY,
            target.maxX,
            target.maxY,
            w,
            h,
          );
          return;
        }
        // fit what is on the screen: hidden work would otherwise zoom the plan
        // out to make room for something nobody can see
        const entities = session.doc
          .all()
          .filter((entity) => isEntityVisible(session.doc, entity));
        if (entities.length === 0) {
          viewport.fit(-6, -6, 6, 6, w, h); // empty plan → ~12 m around origin
          return;
        }
        let minX = Infinity;
        let minY = Infinity;
        let maxX = -Infinity;
        let maxY = -Infinity;
        for (const entity of entities) {
          const b = entity.getBounds();
          if (b.minX < minX) minX = b.minX;
          if (b.minY < minY) minY = b.minY;
          if (b.maxX > maxX) maxX = b.maxX;
          if (b.maxY > maxY) maxY = b.maxY;
        }
        viewport.fit(minX, minY, maxX, maxY, w, h);
      }),
    ];
    tools.worldTolerance = pickPixels / viewport.scale;
    ui.camera.set({
      scale: viewport.scale,
      offsetX: viewport.offsetX,
      offsetY: viewport.offsetY,
    });

    let panning = false;
    let lastPan = { x: 0, y: 0 };

    /* ── touch: one finger pans (or taps), two fingers pinch-zoom ──
       Tool input is only forwarded on a clean tap (pointerup within slop),
       so gestures never leak half-strokes into the active tool. */
    const touches = new Map<number, { x: number; y: number }>();
    let touchMode: 'tap' | 'pan' | 'pinch' | 'tool-drag' | null = null;
    let tapStart = { x: 0, y: 0 };
    let pinchDist = 0;
    let pinchMid = { x: 0, y: 0 };
    let lastToolPoint = { x: 0, y: 0 };

    /**
     * The glass follows the finger, and only the finger.
     *
     * TOUCH ONLY, checked on the event rather than on a media query: a mouse
     * already puts the cursor beside the point instead of on top of it, and a
     * hybrid laptop should get the loupe for its screen and not for its
     * trackpad. `pointerType` is the honest answer to which one this is.
     *
     * Called from the existing touch handlers and changing none of them — it
     * reads the same client coordinates they already have, and every tool sees
     * exactly the events it saw before.
     */
    const showLoupe = (e: PointerEvent) => {
      if (e.pointerType !== 'touch') return;
      const rect = overlay.getBoundingClientRect();
      const finger = { x: e.clientX - rect.left, y: e.clientY - rect.top };
      const where = loupePlacement(
        finger,
        { width: rect.width, height: rect.height },
        FOOTER_PIXELS,
      );
      loupe.frame.style.left = `${where.left}px`;
      loupe.frame.style.top = `${where.top}px`;
      loupe.frame.classList.remove('hidden');
      paintLoupe(loupe, viewport, finger, {
        doc: session.doc,
        view: planView(),
        selection: new Set(session.selection.list()),
        showMarks: ui.showMarks.get(),
        underlay: ui.underlay.get(),
        showDemolition: ui.showDemolition.get(),
        measureMode: ui.measureMode.get(),
        overlay: ui.overlay.get(),
      });
    };

    const hideLoupe = () => loupe.frame.classList.add('hidden');

    const forward = (fn: () => void) => {
      try {
        fn();
      } catch (err) {
        ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
      }
    };

    const toolPoint = (e: PointerEvent) => {
      const raw = viewport.toWorld(e.offsetX, e.offsetY);
      const snap = session.snap.snap(raw, SNAP_PIXELS / viewport.scale);
      ui.setSnap(snap);
      return { point: snap ? snap.point : raw, snapped: !!snap };
    };

    /** where the finger picked something up, so it can be put back exactly */
    let dragOrigin: Point | null = null;

    /**
     * Snapped world point for a touch.
     *
     * Through the magnetic policy rather than straight at the engine: the
     * engine picks the CLOSEST candidate, which on a phone is the wrong
     * question — a thumb lands within a centimetre of what it meant, so what
     * matters is which candidate was being reached for. Corners pull from
     * further, coming back to the start snaps home, and the net narrows once
     * something is in hand.
     */
    const touchWorld = (e: PointerEvent) => {
      const rect = overlay.getBoundingClientRect();
      const raw = viewport.toWorld(e.clientX - rect.left, e.clientY - rect.top);
      const snap = magneticSnap(
        session.snap,
        raw,
        touchSnapOptions(viewport.scale, touchMode === 'tool-drag', dragOrigin),
      );
      ui.setSnap(snap);
      return { point: snap ? snap.point : raw, snapped: !!snap };
    };

    const onTouchDown = (e: PointerEvent) => {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        tapStart = { x: e.clientX, y: e.clientY };
        lastPan = { x: e.clientX, y: e.clientY };
        // grip / room-handle / selected entity under the finger → drag it,
        // otherwise this is a tap-or-pan
        pickPixels = TOUCH_PICK_PIXELS;
        tools.worldTolerance = pickPixels / viewport.scale;
        const { point, snapped } = touchWorld(e);
        if (tools.hitDraggable(point, tools.worldTolerance)) {
          touchMode = 'tool-drag';
          // recorded BEFORE the tool sees the press, so "home" is where the
          // thing actually was rather than wherever the first move put it
          dragOrigin = point;
          lastToolPoint = point;
          forward(() =>
            tools.pointerDown({ point, modifiers: modifiersOf(e), snapped }),
          );
        } else {
          touchMode = 'tap';
        }
        // Both modes put a finger over the point that matters: a drag is
        // holding the thing being moved, and a tap is about to place one. Pan
        // and pinch are neither — nothing under the finger is being aimed at —
        // so the glass is not raised for them and is put away below if a tap
        // turns into one.
        showLoupe(e);
      } else if (touches.size === 2) {
        // a second finger ends any in-progress drag, then starts a pinch
        if (touchMode === 'tool-drag') {
          forward(() =>
            tools.pointerUp({
              point: lastToolPoint,
              modifiers: modifiersOf(e),
            }),
          );
          ui.setSnap(null);
        }
        touchMode = 'pinch';
        hideLoupe();
        const [a, b] = [...touches.values()];
        pinchDist = Math.hypot(b.x - a.x, b.y - a.y);
        pinchMid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      } else {
        touchMode = null;
      }
    };

    const onTouchMove = (e: PointerEvent) => {
      const touch = touches.get(e.pointerId);
      if (!touch) return;
      touch.x = e.clientX;
      touch.y = e.clientY;
      if (touchMode === 'tool-drag') {
        const { point, snapped } = touchWorld(e);
        lastToolPoint = point;
        forward(() =>
          tools.pointerMove({ point, modifiers: modifiersOf(e), snapped }),
        );
        // AFTER the tool has moved, so the glass shows the rubber band where
        // it now is rather than where it was one frame ago
        showLoupe(e);
        return;
      }
      if (touchMode === 'tap') {
        if (
          Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) >
          TAP_SLOP_PIXELS
        ) {
          touchMode = 'pan';
          lastPan = { x: e.clientX, y: e.clientY };
          // this finger is moving the plan now, not aiming at anything on it
          hideLoupe();
        } else {
          showLoupe(e);
        }
      } else if (touchMode === 'pan') {
        viewport.panBy(e.clientX - lastPan.x, e.clientY - lastPan.y);
        lastPan = { x: e.clientX, y: e.clientY };
      } else if (touchMode === 'pinch' && touches.size === 2) {
        const [a, b] = [...touches.values()];
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (pinchDist > 0 && dist > 0) {
          const rect = overlay.getBoundingClientRect();
          viewport.zoomAt(
            mid.x - rect.left,
            mid.y - rect.top,
            dist / pinchDist,
          );
        }
        viewport.panBy(mid.x - pinchMid.x, mid.y - pinchMid.y);
        pinchDist = dist;
        pinchMid = mid;
      }
    };

    const onTouchEnd = (e: PointerEvent, cancelled: boolean) => {
      if (!touches.delete(e.pointerId)) return;
      // the finger is off the glass, so there is nothing under it to see —
      // FIRST, so an early return below cannot leave the loupe up forever
      hideLoupe();
      dragOrigin = null;
      if (touchMode === 'tool-drag') {
        const modifiers = modifiersOf(e);
        if (cancelled) forward(() => tools.key('Escape'));
        else {
          const { point, snapped } = touchWorld(e);
          forward(() => tools.pointerUp({ point, modifiers, snapped }));
        }
        ui.setSnap(null);
      } else if (touchMode === 'tap' && !cancelled) {
        pickPixels = TOUCH_PICK_PIXELS;
        tools.worldTolerance = pickPixels / viewport.scale;
        const { point, snapped } = touchWorld(e);
        const modifiers = modifiersOf(e);
        forward(() => {
          tools.pointerDown({ point, modifiers, snapped });
          tools.pointerUp({ point, modifiers, snapped });
        });
      }
      if (touches.size === 1) {
        /* pinch collapsing to one finger continues as a pan */
        const [remaining] = [...touches.values()];
        touchMode = 'pan';
        lastPan = { x: remaining.x, y: remaining.y };
      } else if (touches.size === 0) {
        touchMode = null;
      }
    };

    const onPointerDown = (e: PointerEvent) => {
      overlay.setPointerCapture(e.pointerId);
      if (e.pointerType === 'touch') {
        onTouchDown(e);
        return;
      }
      pickPixels = PICK_PIXELS;
      tools.worldTolerance = pickPixels / viewport.scale;
      if (e.button === 1) {
        panning = true;
        lastPan = { x: e.clientX, y: e.clientY };
        e.preventDefault();
        return;
      }
      if (e.button !== 0) return;
      const { point, snapped } = toolPoint(e);
      forward(() =>
        tools.pointerDown({ point, modifiers: modifiersOf(e), snapped }),
      );
    };

    const onPointerMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        onTouchMove(e);
        return;
      }
      if (panning) {
        viewport.panBy(e.clientX - lastPan.x, e.clientY - lastPan.y);
        lastPan = { x: e.clientX, y: e.clientY };
        return;
      }
      const { point, snapped } = toolPoint(e);
      ui.coords.set(point);
      forward(() =>
        tools.pointerMove({ point, modifiers: modifiersOf(e), snapped }),
      );
    };

    const onPointerUp = (e: PointerEvent) => {
      if (e.pointerType === 'touch') {
        onTouchEnd(e, false);
        return;
      }
      if (panning && e.button === 1) {
        panning = false;
        return;
      }
      if (e.button !== 0) return;
      const { point, snapped } = toolPoint(e);
      forward(() =>
        tools.pointerUp({ point, modifiers: modifiersOf(e), snapped }),
      );
    };

    const onPointerCancel = (e: PointerEvent) => {
      if (e.pointerType === 'touch') onTouchEnd(e, true);
    };

    const onPointerLeave = () => {
      ui.coords.set(null);
      ui.setSnap(null);
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      viewport.zoomAt(e.offsetX, e.offsetY, e.deltaY < 0 ? 1.15 : 1 / 1.15);
    };

    const onContextMenu = (e: Event) => e.preventDefault();

    overlay.addEventListener('pointerdown', onPointerDown);
    overlay.addEventListener('pointermove', onPointerMove);
    overlay.addEventListener('pointerup', onPointerUp);
    overlay.addEventListener('pointercancel', onPointerCancel);
    overlay.addEventListener('pointerleave', onPointerLeave);
    overlay.addEventListener('wheel', onWheel, { passive: false });
    overlay.addEventListener('contextmenu', onContextMenu);

    return () => {
      cancelAnimationFrame(baseRaf);
      cancelAnimationFrame(blinkRaf);
      observer.disconnect();
      for (const unsub of unsubs) unsub();
      overlay.removeEventListener('pointerdown', onPointerDown);
      overlay.removeEventListener('pointermove', onPointerMove);
      overlay.removeEventListener('pointerup', onPointerUp);
      overlay.removeEventListener('pointercancel', onPointerCancel);
      overlay.removeEventListener('pointerleave', onPointerLeave);
      overlay.removeEventListener('wheel', onWheel);
      overlay.removeEventListener('contextmenu', onContextMenu);
    };
  }, [session, ui, tools]);

  return (
    <div className="viewport" ref={containerRef}>
      <canvas ref={baseRef} />
      <canvas ref={overlayRef} />
      {/* The touch loupe. Hidden and `pointer-events: none` at rest, so it
          takes no space and can never intercept a gesture meant for the plan —
          it is a picture of the drawing, not part of it. Two stacked canvases
          because the overlay renderer clears its own surface. */}
      <div
        ref={loupeRef}
        aria-hidden="true"
        className="pointer-events-none absolute z-20 hidden overflow-hidden rounded-full border border-separator bg-surface shadow-overlay"
        style={{ width: LOUPE_SIZE, height: LOUPE_SIZE }}
      >
        <canvas ref={loupeBaseRef} className="absolute inset-0" />
        <canvas ref={loupeOverlayRef} className="absolute inset-0" />
      </div>
    </div>
  );
}
