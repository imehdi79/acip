/**
 * What each kind of thing looks like, in one table for both views.
 *
 * Colour by WHAT A THING IS rather than by what it is made of. A plan is read
 * structurally — where are the walls, where are the openings — and that
 * question has the same answer whichever material was picked, so a wall stays
 * a wall whether it is blockwork or brick. It also means a drawing looks the
 * same before anybody has said what anything is made of, which is most of the
 * time a plan is being drawn.
 *
 * Shared by the 2D renderer and the 3D viewer on purpose: the two used to pick
 * colours independently, so the same wall could be grey on the plan and beige
 * in the model, and nothing but eyesight would connect them.
 *
 * The hues are the ones the trade already uses — stone for masonry, concrete
 * grey for slabs, terracotta for roofs, timber for doors, glass blue for
 * glazing — so the model reads without a legend.
 */
export const SHAPE_COLORS: Readonly<Record<string, string>> = {
  wall: '#d8d2c6',
  slab: '#b9bec4',
  roof: '#b5623f',
  door: '#a5714a',
  window: '#79b0d8',
  stair: '#9aa3ad',
  /** a finish is a surface treatment, and reads as one: soft, not structural */
  finish: '#8ec4a4',
  line: '#7b838d',
};

/** for a kind nobody has coloured yet — visible, and obviously not special */
export const DEFAULT_SHAPE_COLOR = '#8a94a0';

export function shapeColor(type: string): string {
  return SHAPE_COLORS[type] ?? DEFAULT_SHAPE_COLOR;
}

/**
 * The same colour, lightened toward white, for a filled region under a stroke.
 *
 * Derived rather than listed as a second palette so a fill can never drift
 * away from the line drawn around it — one hue per kind, stated once.
 */
export function shapeFill(type: string, amount = 0.72): string {
  const hex = shapeColor(type).slice(1);
  const to = (at: number) => {
    const channel = Number.parseInt(hex.slice(at, at + 2), 16);
    return Math.round(channel + (255 - channel) * amount);
  };
  return `rgb(${to(0)}, ${to(2)}, ${to(4)})`;
}
