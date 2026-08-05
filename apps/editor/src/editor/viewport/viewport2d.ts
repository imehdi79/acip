import type { Point } from '@acip/editor-core';

const MIN_SCALE = 0.5;
const MAX_SCALE = 5000;

/**
 * The 2D camera. Presentation state only — core's ViewDefinition says WHAT you
 * see, this says FROM WHERE. World is Y-up (CAD), screen is Y-down; the flip
 * lives here and nowhere else. Units: world = meters, scale = px per meter.
 */
export class Viewport2D {
  private listeners = new Set<() => void>();
  private centered = false;

  scale = 60;
  offsetX = 0;
  offsetY = 0;

  toWorld(sx: number, sy: number): Point {
    return {
      x: (sx - this.offsetX) / this.scale,
      y: (this.offsetY - sy) / this.scale,
    };
  }

  toScreen(p: Point): { x: number; y: number } {
    return {
      x: this.offsetX + p.x * this.scale,
      y: this.offsetY - p.y * this.scale,
    };
  }

  zoomAt(sx: number, sy: number, factor: number): void {
    const anchor = this.toWorld(sx, sy);
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, this.scale * factor));
    this.offsetX = sx - anchor.x * this.scale;
    this.offsetY = sy + anchor.y * this.scale;
    this.notify();
  }

  panBy(dx: number, dy: number): void {
    this.offsetX += dx;
    this.offsetY += dy;
    this.notify();
  }

  /** put the world origin at the viewport center on first layout only */
  centerIfUnset(width: number, height: number): void {
    if (this.centered) return;
    this.centered = true;
    this.offsetX = width / 2;
    this.offsetY = height / 2;
    this.notify();
  }

  /**
   * Frame a world bounding box in the viewport (zoom-to-fit). Used by the Fit
   * control — mobile users lose the plan off-screen constantly. An empty or
   * point box falls back to a comfortable default scale, centered on it.
   */
  fit(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    width: number,
    height: number,
  ): void {
    const w = maxX - minX;
    const h = maxY - minY;
    const margin = 0.85; // fraction of the viewport the content fills
    const sx = w > 1e-6 ? (width * margin) / w : Infinity;
    const sy = h > 1e-6 ? (height * margin) / h : Infinity;
    let scale = Math.min(sx, sy);
    if (!Number.isFinite(scale)) scale = 60; // nothing to frame — default zoom
    this.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale));
    const cx = (minX + maxX) / 2;
    const cy = (minY + maxY) / 2;
    this.offsetX = width / 2 - cx * this.scale;
    this.offsetY = height / 2 + cy * this.scale;
    this.centered = true;
    this.notify();
  }

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
