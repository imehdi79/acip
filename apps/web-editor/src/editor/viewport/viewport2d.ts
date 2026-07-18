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

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private notify(): void {
    for (const fn of [...this.listeners]) fn();
  }
}
