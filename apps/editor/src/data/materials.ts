import type {
  EditorSession,
  MaterialId,
  MaterialUnit,
} from '@acip/editor-core';

/**
 * The starter material catalogue.
 *
 * A material is the thing an estimate is actually made of: it carries the UNIT
 * the quantity comes out in and the `costCode` a rate table is looked up by.
 * Core stores it and never prices it — that seam is the whole reason the sheet
 * can show a real quantity today and a real number the day rates arrive.
 *
 * This exists because a template plan starts from `new EditorSession()`, whose
 * material library is EMPTY. A drawing loaded from a file brings its own (see
 * `io/json.ts`), so the picker is full there; without this, every plan the
 * project selector makes would open the add sheet onto nothing at all.
 *
 * The names and cost codes are deliberately IDENTICAL to the ones in
 * `examples/drawing.acip.json` and priced by web-editor's demo rate table. A
 * second, prettier vocabulary here would mean the same wall priced two ways
 * depending on where the drawing came from — and every rate later published
 * against `plaster` would miss a material this app had called something else.
 *
 * It is a seed, not a fetch seam: the office's real catalogue arrives with the
 * project, and this is what a blank page starts from.
 */
export interface StarterMaterial {
  readonly name: string;
  readonly unit: MaterialUnit;
  /** the key a rate table resolves against */
  readonly costCode: string;
  /** m² covered by one `count` unit — a 0.3×0.3 tile is 0.09 */
  readonly coverage?: number;
}

export const STARTER_MATERIALS: readonly StarterMaterial[] = [
  { name: 'Concrete block', unit: 'm3', costCode: 'block' },
  { name: 'Insulation', unit: 'm3', costCode: 'insulation' },
  { name: 'Plaster', unit: 'm3', costCode: 'plaster' },
  { name: 'Paint', unit: 'm2', costCode: 'paint' },
  { name: 'Concrete slab', unit: 'm3', costCode: 'concrete-slab' },
  { name: 'Screed', unit: 'm3', costCode: 'screed' },
  // the one `count` material in the set, and the reason coverage exists: a
  // tiled face is priced in TILES, worked out from the area and the tile size,
  // because nobody models individual tiles
  { name: 'Wall tile', unit: 'count', costCode: 'wall-tile', coverage: 0.09 },
  { name: 'Floor tile', unit: 'm2', costCode: 'floor-tile' },
  { name: 'Roof structure', unit: 'm3', costCode: 'roof-structure' },
  { name: 'Roofing', unit: 'm3', costCode: 'roofing' },
];

/**
 * Put the starter catalogue in the document, unless it already has one.
 *
 * The guard is not ceremony. This runs on every generated plan, and a document
 * that arrived from a file carries the office's own materials with real ids
 * that finishes already reference — adding a second "Plaster" beside them would
 * split one trade across two cost lines and leave the picker showing the same
 * word twice with no way to tell which is which.
 */
export function seedMaterials(session: EditorSession): MaterialId[] {
  if (session.doc.materials.list().length > 0) return [];
  return STARTER_MATERIALS.map((material) =>
    session.dispatch<MaterialId>('MATERIAL.ADD', { ...material }),
  );
}
