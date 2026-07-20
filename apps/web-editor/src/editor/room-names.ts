import type { EntityId } from '@acip/editor-core';
import { ValueStore } from './store';

/**
 * User-given room names. Rooms are derived (detectSpaces), not entities, so a
 * name has no home in the document — it's keyed by the room's boundary walls
 * (stable across resizing, unlike the centroid key) and persisted per browser
 * in localStorage. Caveat: names travel with the browser, not the .acip file.
 */
const STORAGE_KEY = 'acip.room-names';

function load(): Record<string, string> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as Record<string, string>;
  } catch {
    // corrupt / unavailable — start empty
  }
  return {};
}

export const roomNames = new ValueStore<Record<string, string>>(load());

/** stable identity for a room: its boundary walls, order-independent */
export function roomNameKey(boundaryWallIds: readonly EntityId[]): string {
  return [...boundaryWallIds].sort().join('|');
}

export function getRoomName(key: string): string {
  return roomNames.get()[key] ?? '';
}

export function setRoomName(key: string, name: string): void {
  const next = { ...roomNames.get() };
  const trimmed = name.trim();
  if (trimmed) next[key] = trimmed;
  else delete next[key];
  roomNames.set(next);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // best-effort persistence
  }
}
