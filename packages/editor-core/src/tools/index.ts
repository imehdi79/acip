import type { Point } from '../geometry/primitives/point.js';
import type { DrawingDocument } from '../document/document.js';
import type { SelectionSet } from '../selection/index.js';
import type { SnapEngine } from '../snapping/index.js';

/**
 * Tools are interactive state machines consuming ABSTRACT input (world
 * coordinates, never DOM events). They gather parameters click by click,
 * then dispatch the same commands an agent calls with params upfront.
 */
export interface InputModifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
}

export interface ToolInputEvent {
  readonly point: Point;
  readonly modifiers: InputModifiers;
}

export interface ToolContext {
  readonly doc: DrawingDocument;
  readonly selection: SelectionSet;
  readonly snap: SnapEngine;
  dispatch<R = unknown>(name: string, params?: unknown): R;
}

export interface Tool {
  readonly id: string;
  activate(ctx: ToolContext): void;
  deactivate(): void;
  onPointerDown(e: ToolInputEvent): void;
  onPointerMove(e: ToolInputEvent): void;
  onPointerUp(e: ToolInputEvent): void;
  onKey(key: string): void;
}
