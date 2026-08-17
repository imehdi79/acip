/**
 * Rates, by the kind of thing they price.
 *
 * This is the data LAYER, not the data: it is a seam, deliberately behind an
 * async call, so that the day these come from a server, a project file or the
 * rates table the request system already stores, only this file changes. The
 * wizard that renders them never learns where they came from.
 *
 * Hard-coded for now, and only for the four kinds the estimator walks. A kind
 * with no rates is a normal answer, not a missing one — a plan holds stairs and
 * slabs too, and pricing them is a later question.
 */

export interface PriceItem {
  readonly id: string;
  /** what is being charged for, in the estimator's own words */
  readonly label: string;
  /** what the rate is charged per: `m`, `m²`, `each` */
  readonly unit: string;
  /** money per unit. Currency is not modelled yet — one project, one currency */
  readonly rate: number;
  /**
   * One line saying what the rate covers, and — where it is not obvious — what
   * the unit is measured OVER. "per face" and "net floor area" are the whole
   * difference between a right quantity and a doubled one, and the unit column
   * cannot say them: `m²` is the same two characters either way.
   *
   * It must never name a currency or repeat the number. The row already shows
   * both, and there is still only one currency in the entire app (see `rate`
   * above) — so a line that wrote one down would be inventing the thing this
   * file has deliberately not modelled yet.
   *
   * Optional because it is prose, and prose is the first thing missing from a
   * book that arrives from a server: the twelve written here all carry one,
   * but the TYPE must not promise what a fetched book cannot. The sheet says
   * so out loud when a rate has none, rather than opening an empty box.
   */
  readonly detail?: string;
}

/** rates keyed by `EstimatorStep.kind` — `wall`, `room`, `window`, `door`… */
export type PriceBook = Readonly<Record<string, readonly PriceItem[]>>;

/** one thing a shape can be made of — an entry in the build item's picker */
export interface BuildOption {
  readonly id: string;
  readonly label: string;
}

/**
 * What a shape is BUILT FROM: the one answer the rates below it hang off.
 *
 * It is not a rate and never carries a number. Brick or block changes what
 * "Blockwork, 48.00 / m²" even means, so it sits ABOVE the rate list rather
 * than in it, and it is a choice out of a list rather than a line to tick.
 *
 * Every kind the estimator walks gets one — a wall is built of something, and
 * so is a floor, a window and a door. A kind with none is a normal answer, the
 * same way a kind with no rates is.
 */
export interface BuildItem {
  readonly id: string;
  /** what the choice is called, in the estimator's own words */
  readonly label: string;
  /** one line on what choosing here decides; same rules as `PriceItem.detail` */
  readonly detail: string;
  readonly options: readonly BuildOption[];
}

/** build items keyed by `EstimatorStep.kind`, exactly as `PriceBook` is */
export type BuildBook = Readonly<Record<string, BuildItem>>;

const BOOK: PriceBook = {
  wall: [
    {
      id: 'wall.block',
      label: 'Blockwork',
      unit: 'm²',
      rate: 48,
      detail: 'Blocks, mortar and lifting, measured on the wall elevation.',
    },
    {
      id: 'wall.plaster',
      label: 'Plaster, two coats',
      unit: 'm²',
      rate: 22,
      detail:
        'Scratch and finish coat, per FACE — a wall done both sides counts twice.',
    },
    {
      id: 'wall.paint',
      label: 'Paint',
      unit: 'm²',
      rate: 9.5,
      detail:
        'Primer and topcoats over plaster, per face, same area as the plaster.',
    },
  ],
  room: [
    {
      id: 'room.screed',
      label: 'Floor screed',
      unit: 'm²',
      rate: 31,
      detail:
        'Levelling screed on the slab, over the room NET area, inside the plaster.',
    },
    {
      id: 'room.tiling',
      label: 'Floor tiling',
      unit: 'm²',
      rate: 64,
      detail:
        'Tile, adhesive and grout on the screed; cuts and waste are in the rate.',
    },
    {
      id: 'room.ceiling',
      label: 'Ceiling finish',
      unit: 'm²',
      rate: 27,
      detail:
        'Skim and paint to the soffit, taken flat — no drop for bulkheads.',
    },
  ],
  window: [
    {
      id: 'window.unit',
      label: 'Window unit',
      unit: 'each',
      rate: 420,
      detail:
        'Frame and glazing supplied only, one rate whatever the opening size.',
    },
    {
      id: 'window.fitting',
      label: 'Fitting',
      unit: 'each',
      rate: 85,
      detail: 'Labour to set, fix and seal the unit into the opening.',
    },
    {
      id: 'window.sill',
      label: 'Sill',
      unit: 'm',
      rate: 38,
      detail: 'Internal sill board, run along the width of the opening.',
    },
  ],
  door: [
    {
      id: 'door.leaf',
      label: 'Door leaf',
      unit: 'each',
      rate: 260,
      detail: 'The leaf supplied only; hanging it is in the frame rate.',
    },
    {
      id: 'door.frame',
      label: 'Frame and architrave',
      unit: 'each',
      rate: 140,
      detail: 'Frame, architrave to both faces, and hanging the leaf on it.',
    },
    {
      id: 'door.ironmongery',
      label: 'Ironmongery',
      unit: 'each',
      rate: 55,
      detail: 'Hinges, handle and latch, priced as one set per door.',
    },
  ],
};

const BUILDS: BuildBook = {
  wall: {
    id: 'wall.built',
    label: 'Built from',
    detail:
      'What the wall is made of. It sets the thickness a course comes in and which rates below apply at all.',
    options: [
      { id: 'wall.built.brick', label: 'Brick' },
      { id: 'wall.built.block', label: 'Concrete block' },
      { id: 'wall.built.aac', label: 'Lightweight block (AAC)' },
      { id: 'wall.built.concrete', label: 'Poured concrete' },
      { id: 'wall.built.stud', label: 'Stud and board' },
    ],
  },
  room: {
    id: 'room.built',
    label: 'Floor built on',
    detail:
      'What the floor finish is laid over. The screed and tiling rates below assume it.',
    options: [
      { id: 'room.built.slab', label: 'Concrete slab' },
      { id: 'room.built.joists', label: 'Timber joists' },
      { id: 'room.built.raised', label: 'Raised access floor' },
    ],
  },
  window: {
    id: 'window.built',
    label: 'Frame built from',
    detail:
      'The frame material. It carries most of the unit price, and the fitting rate follows it.',
    options: [
      { id: 'window.built.upvc', label: 'uPVC' },
      { id: 'window.built.aluminium', label: 'Aluminium' },
      { id: 'window.built.timber', label: 'Timber' },
    ],
  },
  door: {
    id: 'door.built',
    label: 'Leaf built from',
    detail:
      'What the leaf is made of. A fire or external door is priced from here, not from the ironmongery.',
    options: [
      { id: 'door.built.hollow', label: 'Hollow-core timber' },
      { id: 'door.built.solid', label: 'Solid timber' },
      { id: 'door.built.steel', label: 'Steel' },
      { id: 'door.built.glazed', label: 'Glazed' },
    ],
  },
};

/**
 * The whole book. Async because the real one will be fetched, and a caller
 * written against a promise today needs no changing when it is.
 */
export async function loadPrices(): Promise<PriceBook> {
  return BOOK;
}

/**
 * The build items, behind the same seam and for the same reason.
 *
 * A second call rather than one payload holding both: they are two lookups with
 * two shapes, and a caller that only wants rates should not have to know what a
 * build item is. Both resolve from the same file today and would come from the
 * same request tomorrow.
 */
export async function loadBuilds(): Promise<BuildBook> {
  return BUILDS;
}

/**
 * The rates for one kind of shape — empty for a kind nobody has priced.
 *
 * A free function over the book rather than a method on it: the lookup is the
 * whole decision, and it is testable without loading anything.
 */
export function pricesFor(book: PriceBook, kind: string): readonly PriceItem[] {
  return book[kind] ?? [];
}

/** what one kind of shape is built from — null for a kind nobody has said */
export function buildFor(book: BuildBook, kind: string): BuildItem | null {
  return book[kind] ?? null;
}
