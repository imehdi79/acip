import type { EditorSession } from '@acip/editor-core';
import { WallEntity } from '@acip/editor-core';
import { seedCatalog } from './runtime';
import { detectRectRoom } from './rooms';

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

interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function presetBounds(walls: PresetWall[]): Bounds {
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** union of every entity's bounds, or null for an empty document */
function documentBounds(session: EditorSession): Bounds | null {
  const entities = session.doc.all();
  if (entities.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const entity of entities) {
    const b = entity.getBounds();
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  return { minX, minY, maxX, maxY };
}

const SNAP_TOL = 1e-3;
const samePt = (p: PresetPoint, q: PresetPoint): boolean =>
  Math.abs(p.x - q.x) <= SNAP_TOL && Math.abs(p.y - q.y) <= SNAP_TOL;

function wallBaselines(
  session: EditorSession,
): { a: PresetPoint; b: PresetPoint }[] {
  const out: { a: PresetPoint; b: PresetPoint }[] = [];
  for (const entity of session.doc.all()) {
    if (entity instanceof WallEntity) out.push(entity.getBaseline());
  }
  return out;
}

function coincides(
  baselines: { a: PresetPoint; b: PresetPoint }[],
  a: PresetPoint,
  b: PresetPoint,
): boolean {
  return baselines.some(
    (bl) =>
      (samePt(bl.a, a) && samePt(bl.b, b)) ||
      (samePt(bl.a, b) && samePt(bl.b, a)),
  );
}

/**
 * Drop a preset into the CURRENT document without resetting it. If a
 * rectangular room is selected, the new room SNAPS flush against its right
 * edge, bottom-aligned, and any new wall that coincides with an existing one
 * is skipped — so adjacent rooms share a wall instead of doubling it.
 * Otherwise it lands to the right of everything drawn, vertically centered.
 * One undo step, typed like the rest.
 */
export function addPreset(session: EditorSession, preset: RoomPreset): void {
  const selected = detectRectRoom(session, session.selection.list());
  const pb = presetBounds(preset.walls);
  let dx = 0;
  let dy = 0;
  if (selected) {
    dx = selected.maxX - pb.minX; // left edge on the room's right edge
    dy = selected.minY - pb.minY; // bottom-aligned
  } else {
    const existing = documentBounds(session);
    if (existing) {
      const gap = 2; // meters between the existing plan and the new room
      dx = existing.maxX + gap - pb.minX;
      dy = (existing.minY + existing.maxY) / 2 - (pb.minY + pb.maxY) / 2;
    }
  }
  const wallType = session.doc.types.list('wall')[0]?.id;
  const existingWalls = selected ? wallBaselines(session) : [];
  session.history.beginGroup();
  try {
    for (const w of preset.walls) {
      const a = { x: w.a.x + dx, y: w.a.y + dy };
      const b = { x: w.b.x + dx, y: w.b.y + dy };
      // reuse a shared wall rather than drawing a duplicate on top of it
      if (selected && coincides(existingWalls, a, b)) continue;
      session.dispatch('WALL.ADD', {
        a,
        b,
        thickness: 0.3,
        height: 3,
        ...(wallType ? { typeId: wallType } : {}),
      });
    }
  } finally {
    session.history.endGroup();
  }
}
