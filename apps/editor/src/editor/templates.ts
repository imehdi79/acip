import type { EditorSession, Point } from '@acip/editor-core';
import { seedMaterials } from '@/data/materials';

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

  // before the walls, because a fresh document's material library is empty and
  // the estimator prices a wall face by picking one — a plan with no materials
  // opens the add sheet onto nothing at all
  seedMaterials(session);

  for (const { a, b } of TEMPLATE_WALLS[template]) {
    session.dispatch('WALL.ADD', { a, b });
  }
}
