import { useEffect, useRef } from 'react';
import type { InputModifiers, ViewDefinition } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { Viewport2D } from './viewport2d';
import { drawOverlay, drawScene } from './scene-renderer';

const PICK_PIXELS = 8;
const SNAP_PIXELS = 10;
/* fingers are blunter than cursors: wider pick/snap radii, and a movement
   budget below which a touch still counts as a tap rather than a pan */
const TOUCH_PICK_PIXELS = 20;
const TOUCH_SNAP_PIXELS = 24;
const TAP_SLOP_PIXELS = 8;

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
  const viewportRef = useRef<Viewport2D | null>(null);
  if (!viewportRef.current) viewportRef.current = new Viewport2D();

  useEffect(() => {
    const container = containerRef.current;
    const base = baseRef.current;
    const overlay = overlayRef.current;
    const viewport = viewportRef.current;
    if (!container || !base || !overlay || !viewport) return;

    let baseRaf = 0;
    const planView = (): ViewDefinition => ({
      kind: 'plan',
      levelId: ui.activeLevelId.get(),
    });
    const redrawBase = () => {
      cancelAnimationFrame(baseRaf);
      baseRaf = requestAnimationFrame(() => {
        drawScene(
          base,
          viewport,
          session.doc,
          planView(),
          new Set(session.selection.list()),
          ui.showMarks.get(),
          ui.underlay.get(),
        );
      });
    };
    const redrawOverlay = () =>
      drawOverlay(overlay, viewport, ui.overlay.get());

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
        redrawBase();
        redrawOverlay();
      }),
      ui.overlay.subscribe(redrawOverlay),
      ui.activeLevelId.subscribe(redrawBase),
      ui.showMarks.subscribe(redrawBase),
      ui.underlay.subscribe(redrawBase),
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
        const entities = session.doc.all();
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

    let panning = false;
    let lastPan = { x: 0, y: 0 };

    /* ── touch: one finger pans (or taps), two fingers pinch-zoom ──
       Tool input is only forwarded on a clean tap (pointerup within slop),
       so gestures never leak half-strokes into the active tool. */
    const touches = new Map<number, { x: number; y: number }>();
    let touchMode: 'tap' | 'pan' | 'pinch' | null = null;
    let tapStart = { x: 0, y: 0 };
    let pinchDist = 0;
    let pinchMid = { x: 0, y: 0 };

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
      return snap ? snap.point : raw;
    };

    const onTouchDown = (e: PointerEvent) => {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 1) {
        touchMode = 'tap';
        tapStart = { x: e.clientX, y: e.clientY };
        lastPan = { x: e.clientX, y: e.clientY };
      } else if (touches.size === 2) {
        touchMode = 'pinch';
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
      if (touchMode === 'tap') {
        if (
          Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y) >
          TAP_SLOP_PIXELS
        ) {
          touchMode = 'pan';
          lastPan = { x: e.clientX, y: e.clientY };
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
      if (touchMode === 'tap' && !cancelled) {
        pickPixels = TOUCH_PICK_PIXELS;
        tools.worldTolerance = pickPixels / viewport.scale;
        const rect = overlay.getBoundingClientRect();
        const raw = viewport.toWorld(
          e.clientX - rect.left,
          e.clientY - rect.top,
        );
        const snap = session.snap.snap(raw, TOUCH_SNAP_PIXELS / viewport.scale);
        const point = snap ? snap.point : raw;
        const modifiers = modifiersOf(e);
        forward(() => {
          tools.pointerDown({ point, modifiers });
          tools.pointerUp({ point, modifiers });
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
      const point = toolPoint(e);
      forward(() => tools.pointerDown({ point, modifiers: modifiersOf(e) }));
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
      const point = toolPoint(e);
      ui.coords.set(point);
      forward(() => tools.pointerMove({ point, modifiers: modifiersOf(e) }));
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
      const point = toolPoint(e);
      forward(() => tools.pointerUp({ point, modifiers: modifiersOf(e) }));
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
    </div>
  );
}
