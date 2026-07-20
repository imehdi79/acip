import type { EditorSession } from '@acip/editor-core';
import { seedCatalog } from './runtime';

export interface PresetPoint {
  x: number;
  y: number;
}

export interface PresetWall {
  a: PresetPoint;
  b: PresetPoint;
}

export interface RoomPreset {
  id: string;
  name: string;
  dims: string;
  /** wall centerline segments, meters, centered on the origin */
  walls: PresetWall[];
}

/** closed loop of walls through the given corners (last joins back to first) */
function loop(points: PresetPoint[]): PresetWall[] {
  return points.map((p, i) => ({ a: p, b: points[(i + 1) % points.length] }));
}

/**
 * Starter layouts offered on first load and on New. Geometry is centered on
 * the origin so it lands in the middle of the viewport, and drives the modal
 * previews too — the thumbnails are the real walls, not artwork.
 */
export const ROOM_PRESETS: RoomPreset[] = [
  {
    id: 'square',
    name: 'Square room',
    dims: '5 × 5 m',
    walls: loop([
      { x: -2.5, y: -2.5 },
      { x: 2.5, y: -2.5 },
      { x: 2.5, y: 2.5 },
      { x: -2.5, y: 2.5 },
    ]),
  },
  {
    id: 'rectangle',
    name: 'Rectangular room',
    dims: '6 × 4 m',
    walls: loop([
      { x: -3, y: -2 },
      { x: 3, y: -2 },
      { x: 3, y: 2 },
      { x: -3, y: 2 },
    ]),
  },
  {
    id: 'l-shape',
    name: 'L-shaped room',
    dims: '6 × 6 m',
    walls: loop([
      { x: -3, y: -3 },
      { x: 3, y: -3 },
      { x: 3, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 3 },
      { x: -3, y: 3 },
    ]),
  },
  {
    id: 'two-room',
    name: 'Two rooms',
    dims: '8 × 5 m',
    walls: [
      ...loop([
        { x: -4, y: -2.5 },
        { x: 4, y: -2.5 },
        { x: 4, y: 2.5 },
        { x: -4, y: 2.5 },
      ]),
      { a: { x: 0, y: -2.5 }, b: { x: 0, y: 2.5 } }, // partition
    ],
  },
];

/**
 * Replace the document with a preset: reset, re-seed the demo catalog (New
 * wipes it), then draw the preset walls as ONE undo step, typed to the
 * seeded wall assembly so they price immediately.
 */
export function applyPreset(session: EditorSession, preset: RoomPreset): void {
  session.newDocument();
  seedCatalog(session);
  const wallType = session.doc.types.list('wall')[0]?.id;
  session.history.beginGroup();
  try {
    for (const w of preset.walls) {
      session.dispatch('WALL.ADD', {
        a: w.a,
        b: w.b,
        thickness: 0.3,
        height: 3,
        ...(wallType ? { typeId: wallType } : {}),
      });
    }
  } finally {
    session.history.endGroup();
  }
}

/** an empty document with just the demo catalog */
export function applyBlank(session: EditorSession): void {
  session.newDocument();
  seedCatalog(session);
}
