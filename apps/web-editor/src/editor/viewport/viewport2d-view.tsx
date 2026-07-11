import { useEffect, useRef } from 'react';
import type { InputModifiers, ViewDefinition } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { Viewport2D } from './viewport2d';
import { drawOverlay, drawScene } from './scene-renderer';

const PICK_PIXELS = 8;
const SNAP_PIXELS = 10;

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
    const planView = (): ViewDefinition => ({ kind: 'plan', levelId: ui.activeLevelId.get() });
    const redrawBase = () => {
      cancelAnimationFrame(baseRaf);
      baseRaf = requestAnimationFrame(() => {
        drawScene(base, viewport, session.doc, planView(), new Set(session.selection.list()));
      });
    };
    const redrawOverlay = () => drawOverlay(overlay, viewport, ui.overlay.get());

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

    const unsubs = [
      session.doc.events.on('change', redrawBase),
      session.selection.events.on('changed', redrawBase),
      viewport.subscribe(() => {
        tools.worldTolerance = PICK_PIXELS / viewport.scale;
        redrawBase();
        redrawOverlay();
      }),
      ui.overlay.subscribe(redrawOverlay),
      ui.activeLevelId.subscribe(redrawBase),
    ];
    tools.worldTolerance = PICK_PIXELS / viewport.scale;

    let panning = false;
    let lastPan = { x: 0, y: 0 };

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

    const onPointerDown = (e: PointerEvent) => {
      overlay.setPointerCapture(e.pointerId);
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
      if (panning && e.button === 1) {
        panning = false;
        return;
      }
      if (e.button !== 0) return;
      const point = toolPoint(e);
      forward(() => tools.pointerUp({ point, modifiers: modifiersOf(e) }));
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
