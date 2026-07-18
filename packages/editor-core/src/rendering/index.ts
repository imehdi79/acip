import type { EntityId } from '../common/id.js';
import type { Geometry } from '../geometry/shapes.js';
import type { DrawingDocument } from '../document/document.js';
import type { ViewDefinition } from '../views/index.js';
import { entitiesInView, isEntityVisible } from '../views/index.js';

/**
 * Core produces display lists; DRAWING them is the consumer's job.
 * Canvas/WebGL renderer implementations live in web-editor, never here.
 */
export interface DisplayStyle {
  readonly stroke?: string;
  readonly width?: number;
  readonly dash?: readonly number[];
}

export interface RenderItem {
  readonly entityId: EntityId;
  readonly geometry: Geometry;
  readonly style: DisplayStyle;
}

export interface Renderer {
  render(items: readonly RenderItem[]): void;
}

export type { AssemblyStrip, WallAssemblyStrips } from './assembly-strips.js';
export { wallAssemblyStrips } from './assembly-strips.js';

const DEFAULT_STYLE: DisplayStyle = { stroke: '#e0e0e0', width: 1 };

export function buildDisplayList(
  doc: DrawingDocument,
  view: ViewDefinition,
): RenderItem[] {
  return entitiesInView(doc, view)
    .filter((e) => isEntityVisible(doc, e))
    .map((e) => {
      const color = doc.getLayer(e.layerId)?.color;
      return {
        entityId: e.id,
        geometry: e.getEffectiveGeometry(),
        style: color ? { stroke: color, width: 1 } : DEFAULT_STYLE,
      };
    });
}
