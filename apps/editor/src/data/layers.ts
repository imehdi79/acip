/**
 * The layers a shape can be built up from, by the kind of thing being built.
 *
 * This is the data LAYER, not the data: it is a seam, deliberately behind an
 * async call, so that the day these come from a server, a project file or the
 * rates table the request system already stores, only this file changes. The
 * sheet that renders them never learns where they came from.
 *
 * A LAYER, not a rate. It carries no number and no unit, because the estimator
 * no longer starts from a book of prices it asks the user to tick: it starts
 * EMPTY, and the user says what the shape is made up of, in order. What each
 * layer then costs is asked per layer, in its own detail panel, where the
 * quantities it needs can be asked for alongside — a rate on the row here would
 * be a number offered before anything has been measured.
 *
 * Hard-coded for now. A kind with no layers is a normal answer, not a missing
 * one — a plan holds shapes nobody has described yet, and the sheet says so.
 */

/** one thing a shape can be built up from — a row in the add sheet */
export interface LayerOption {
  readonly id: string;
  /** what it is called, in the estimator's own words */
  readonly label: string;
  /**
   * One line on what the layer covers, and — where it is not obvious — what it
   * is measured OVER. It is the whole reason the add sheet is a list of rows
   * rather than a list of names: "Skim" and "Two-coat plaster" are the same
   * four inches of wall to anyone who has not built one, and the label alone
   * cannot separate them.
   *
   * Required, unlike the prose on the rates this replaced. That was optional
   * because a fetched book may hold numbers and no words; a layer has no number
   * at all, so a layer with no words is nothing but an id — there would be
   * nothing on the row to choose between.
   */
  readonly description: string;
}

/** layers keyed by `EstimatorStep.kind` — `wall`, `room`, `window`, `door`… */
export type LayerCatalog = Readonly<Record<string, readonly LayerOption[]>>;

/**
 * Every id is namespaced by its kind (`wall.plaster`, `room.screed`). The sheet
 * keys what the user has added by shape and by side, so an id never has to be
 * unique across the whole catalog — but a wall layer and a floor layer sharing
 * the word `paint` would still make every list this file feeds impossible to
 * read in a debugger, and impossible to key by if the sheet ever carries a
 * choice from one shape to the next.
 */
const CATALOG: LayerCatalog = {
  wall: [
    {
      id: 'wall.blockwork',
      label: 'Blockwork',
      description:
        'Blocks, mortar and lifting — the structural leaf, measured on the wall elevation.',
    },
    {
      id: 'wall.brickwork',
      label: 'Brickwork',
      description:
        'Facing or common brick laid in mortar, taken on the face it is built to.',
    },
    {
      id: 'wall.stud',
      label: 'Stud and board',
      description:
        'Timber or metal studs with board to this face; the board is counted per face, the studs once.',
    },
    {
      id: 'wall.insulation',
      label: 'Insulation',
      description:
        'Batt or board insulation set into or against the frame, over the face area.',
    },
    {
      id: 'wall.vapour',
      label: 'Vapour barrier',
      description:
        'Sheet membrane behind the lining, lapped and taped at every joint.',
    },
    {
      id: 'wall.render',
      label: 'Cement render',
      description:
        'Sand and cement render to this face, straightened before any finish goes over it.',
    },
    {
      id: 'wall.plaster',
      label: 'Plaster, two coats',
      description:
        'Scratch and finish coat to this face; a wall plastered both sides carries this layer twice.',
    },
    {
      id: 'wall.skim',
      label: 'Skim coat',
      description:
        'Thin finish plaster over board or render, ready to decorate.',
    },
    {
      id: 'wall.paint',
      label: 'Paint',
      description:
        'Primer and topcoats over the finished face, taken on the same area as the plaster.',
    },
    {
      id: 'wall.tiling',
      label: 'Wall tiling',
      description:
        'Tile, adhesive and grout to this face; cuts and waste are carried in the layer.',
    },
    {
      id: 'wall.cladding',
      label: 'Cladding',
      description:
        'Board, panel or sheet fixed on rails to this face, with its fixings.',
    },
    {
      id: 'wall.skirting',
      label: 'Skirting',
      description:
        'Skirting run along the foot of this face, measured on the wall length rather than its area.',
    },
  ],
  room: [
    {
      id: 'room.dpm',
      label: 'Damp-proof membrane',
      description:
        'Sheet membrane under the floor build-up, lapped up at the perimeter.',
    },
    {
      id: 'room.insulation',
      label: 'Floor insulation',
      description:
        'Rigid board laid over the slab, over the room NET area, inside the plaster.',
    },
    {
      id: 'room.screed',
      label: 'Floor screed',
      description:
        'Levelling screed over the slab or insulation, taken on the room net area.',
    },
    {
      id: 'room.tiling',
      label: 'Floor tiling',
      description:
        'Tile, adhesive and grout on the screed; cuts and waste are in the layer.',
    },
    {
      id: 'room.timber',
      label: 'Timber flooring',
      description:
        'Boards or engineered plank on the screed, with underlay and expansion gap.',
    },
    {
      id: 'room.skirting',
      label: 'Skirting',
      description:
        'Skirting around the room, measured on the perimeter and not on the floor area.',
    },
    {
      id: 'room.ceiling',
      label: 'Ceiling finish',
      description:
        'Skim and paint to the soffit, taken flat — no drop for bulkheads.',
    },
    {
      id: 'room.suspended',
      label: 'Suspended ceiling',
      description:
        'Grid and tile hung below the soffit, over the same net area as the floor.',
    },
  ],
  door: [
    {
      id: 'door.leaf',
      label: 'Door leaf',
      description: 'The leaf supplied only; hanging it belongs to the frame.',
    },
    {
      id: 'door.frame',
      label: 'Frame and architrave',
      description:
        'Frame, architrave to this face, and hanging the leaf on its hinges.',
    },
    {
      id: 'door.ironmongery',
      label: 'Ironmongery',
      description: 'Hinges, handle and latch, taken as one set per door.',
    },
    {
      id: 'door.finish',
      label: 'Paint or lacquer',
      description:
        'Decoration to this face of the leaf and its frame, both sides counted apart.',
    },
    {
      id: 'door.threshold',
      label: 'Threshold',
      description:
        'Sill or floor trim across the opening where two finishes meet.',
    },
    {
      id: 'door.seals',
      label: 'Seals',
      description:
        'Smoke, acoustic or draught seals let into the frame around the leaf.',
    },
  ],
  window: [
    {
      id: 'window.unit',
      label: 'Window unit',
      description:
        'Frame and glazing supplied only, whatever the opening size.',
    },
    {
      id: 'window.fitting',
      label: 'Fitting',
      description: 'Labour to set, fix and seal the unit into the opening.',
    },
    {
      id: 'window.sill',
      label: 'Sill',
      description:
        'Sill board or stone to this face, run along the width of the opening.',
    },
    {
      id: 'window.reveal',
      label: 'Reveal finish',
      description:
        'Plaster or board to the reveal and head on this face, measured on the girth.',
    },
    {
      id: 'window.trim',
      label: 'Trim',
      description: 'Architrave or bead around the opening on this face.',
    },
    {
      id: 'window.blind',
      label: 'Blind or shading',
      description:
        'Blind, shutter or external shading fitted to this face of the opening.',
    },
  ],
  slab: [
    {
      id: 'slab.hardcore',
      label: 'Hardcore and blinding',
      description: 'Compacted fill and sand blinding under the slab.',
    },
    {
      id: 'slab.dpm',
      label: 'Damp-proof membrane',
      description: 'Sheet membrane under the pour, lapped and taped.',
    },
    {
      id: 'slab.insulation',
      label: 'Insulation',
      description: 'Rigid board under or over the slab, to its full area.',
    },
    {
      id: 'slab.reinforcement',
      label: 'Reinforcement',
      description: 'Mesh or bar with its spacers, laid before the pour.',
    },
    {
      id: 'slab.concrete',
      label: 'Concrete',
      description: 'The pour itself, measured on the slab area and thickness.',
    },
    {
      id: 'slab.finish',
      label: 'Power float',
      description:
        'Trowelled finish to this face, ready to take a floor covering.',
    },
  ],
  roof: [
    {
      id: 'roof.structure',
      label: 'Structure',
      description: 'Rafters, trusses or purlins carrying the roof.',
    },
    {
      id: 'roof.deck',
      label: 'Deck',
      description: 'Board or sheet decking over the structure, on the slope.',
    },
    {
      id: 'roof.vapour',
      label: 'Vapour control layer',
      description: 'Membrane on the warm side of the insulation, lapped.',
    },
    {
      id: 'roof.insulation',
      label: 'Insulation',
      description: 'Board or quilt between or over the structure.',
    },
    {
      id: 'roof.waterproofing',
      label: 'Waterproofing',
      description: 'Membrane or felt to this face, dressed into the upstands.',
    },
    {
      id: 'roof.covering',
      label: 'Covering',
      description: 'Tile, sheet or slate to this face, measured on the slope.',
    },
    {
      id: 'roof.flashing',
      label: 'Flashing',
      description:
        'Metal at abutments and edges, measured on the run rather than the area.',
    },
  ],
  stair: [
    {
      id: 'stair.structure',
      label: 'Structure',
      description: 'Strings, carriage or concrete flight carrying the steps.',
    },
    {
      id: 'stair.treads',
      label: 'Treads',
      description: 'The tread to each step, counted per step.',
    },
    {
      id: 'stair.risers',
      label: 'Risers',
      description: 'The riser to each step; an open flight has none.',
    },
    {
      id: 'stair.nosing',
      label: 'Nosing',
      description: 'Edge trim to the tread, measured on the going.',
    },
    {
      id: 'stair.balustrade',
      label: 'Balustrade',
      description: 'Guarding to this side of the flight, measured on the rake.',
    },
    {
      id: 'stair.handrail',
      label: 'Handrail',
      description:
        'Rail to this side, with its brackets, measured on the same rake.',
    },
    {
      id: 'stair.finish',
      label: 'Finish',
      description:
        'Paint, carpet or stone to the flight, over the treads and risers.',
    },
  ],
};

/**
 * The layers on offer for one kind of shape — empty for a kind nobody has
 * described yet.
 *
 * Async because the real one will be fetched, and a caller written against a
 * promise today needs no changing when it is. It takes the KIND rather than
 * handing back the whole catalog: the add sheet only ever opens on one shape,
 * and a wall's sheet has no business holding a roof's layers in memory — that
 * is also the request a server would be asked, one kind at a time.
 */
export async function loadLayers(
  kind: string,
): Promise<readonly LayerOption[]> {
  return layersFor(CATALOG, kind);
}

/**
 * The lookup, over a catalog handed in.
 *
 * A free function rather than a method on the catalog: it is the whole
 * decision, and it is testable without loading anything.
 */
export function layersFor(
  catalog: LayerCatalog,
  kind: string,
): readonly LayerOption[] {
  return catalog[kind] ?? [];
}

/**
 * The whole catalog, for the tests that check it against the walk.
 *
 * Exported so that "is this keyed by the words the estimator actually uses"
 * can be asked of every kind at once. Nothing in the app reads it — the sheet
 * goes through `loadLayers`, which is the seam a server will arrive at.
 */
export const LAYER_CATALOG = CATALOG;
