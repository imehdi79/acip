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
}

/** rates keyed by `EstimatorStep.kind` — `wall`, `room`, `window`, `door`… */
export type PriceBook = Readonly<Record<string, readonly PriceItem[]>>;

const BOOK: PriceBook = {
  wall: [
    { id: 'wall.block', label: 'Blockwork', unit: 'm²', rate: 48 },
    { id: 'wall.plaster', label: 'Plaster, two coats', unit: 'm²', rate: 22 },
    { id: 'wall.paint', label: 'Paint', unit: 'm²', rate: 9.5 },
  ],
  room: [
    { id: 'room.screed', label: 'Floor screed', unit: 'm²', rate: 31 },
    { id: 'room.tiling', label: 'Floor tiling', unit: 'm²', rate: 64 },
    { id: 'room.ceiling', label: 'Ceiling finish', unit: 'm²', rate: 27 },
  ],
  window: [
    { id: 'window.unit', label: 'Window unit', unit: 'each', rate: 420 },
    { id: 'window.fitting', label: 'Fitting', unit: 'each', rate: 85 },
    { id: 'window.sill', label: 'Sill', unit: 'm', rate: 38 },
  ],
  door: [
    { id: 'door.leaf', label: 'Door leaf', unit: 'each', rate: 260 },
    {
      id: 'door.frame',
      label: 'Frame and architrave',
      unit: 'each',
      rate: 140,
    },
    { id: 'door.ironmongery', label: 'Ironmongery', unit: 'each', rate: 55 },
  ],
};

/**
 * The whole book. Async because the real one will be fetched, and a caller
 * written against a promise today needs no changing when it is.
 */
export async function loadPrices(): Promise<PriceBook> {
  return BOOK;
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
