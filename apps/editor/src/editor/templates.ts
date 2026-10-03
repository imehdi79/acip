import type { EditorSession, Point } from '@acip/editor-core';

/**
 * Starter plans offered by the project selector. The ids double as the
 * selector's card ids, so picking a card names the plan to generate.
 */
export type PlanTemplateId =
  | 'blank'
  | 'free-draw'
  | 'square'
  | 'rectangle'
  | 'l-shape'
  | 'two-room';

interface Segment {
  a: Point;
  b: Point;
}

const p = (x: number, y: number): Point => ({ x, y });

/** Corner list -> closed loop of walls; the last corner joins back to the first. */
const loop = (corners: Point[]): Segment[] =>
  corners.map((a, i) => ({ a, b: corners[(i + 1) % corners.length] }));

/**
 * Outlines in metres with the origin at each plan's bottom-left corner. Walls
 * sharing an endpoint auto-join, so a loop comes out as a closed room.
 */
const TEMPLATE_WALLS: Record<PlanTemplateId, Segment[]> = {
  // Both start empty: blank is a clean sheet, free-draw is drawn by hand.
  blank: [],
  'free-draw': [],

  square: loop([p(0, 0), p(4, 0), p(4, 4), p(0, 4)]),

  rectangle: loop([p(0, 0), p(6, 0), p(6, 4), p(0, 4)]),

  'l-shape': loop([p(0, 0), p(6, 0), p(6, 3), p(3, 3), p(3, 5), p(0, 5)]),

  // The outer walls are split at the divider so all three meet on a shared
  // endpoint and auto-join. Running the box as one loop would leave the
  // divider's ends dangling mid-wall, and it would read as one room, not two.
  'two-room': [
    { a: p(0, 0), b: p(4.5, 0) },
    { a: p(4.5, 0), b: p(8, 0) },
    { a: p(8, 0), b: p(8, 5) },
    { a: p(8, 5), b: p(4.5, 5) },
    { a: p(4.5, 5), b: p(0, 5) },
    { a: p(0, 5), b: p(0, 0) },
    { a: p(4.5, 0), b: p(4.5, 5) },
  ],
};

/**
 * Replace the document with the chosen starter plan. It always resets first,
 * so re-running it — including React's double-invoked effects in dev — cannot
 * stack two copies of the same plan.
 */
export function generatePlan(
  session: EditorSession,
  template: PlanTemplateId,
): void {
  session.newDocument();

  // No material catalogue is seeded with it. A starter plan used to arrive
  // carrying ten of them — block, plaster, paint — on the reasoning that the
  // add sheet would otherwise open onto nothing. It opens onto a NEW LAYER
  // button instead, and that is the better empty: a shipped catalogue is a
  // guess at somebody else's trades, and every one of those guesses had to be
  // scrolled past, or worse, half-matched to the thing actually being priced.
  // What the estimate is built from is now entirely the estimator's to say.

  for (const { a, b } of TEMPLATE_WALLS[template]) {
    session.dispatch('WALL.ADD', { a, b });
  }
}
