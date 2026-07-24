import { useRef } from 'react';
import { IconCheck, IconX } from '@tabler/icons-react';
import { DoorEntity, WallEntity, WindowEntity } from '@acip/editor-core';
import type { EntityId } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision, useSelectionIds } from '../hooks';
import { useStoreValue } from '../store';
import { formatLengthValue, lengthUnit, parseLength } from '../units';
import { detectRectRoom, resizeRectRoom } from '../rooms';
import type { RectRoom } from '../rooms';

/** the rectangular room in the current selection, recomputed per commit */
export function useRectRoom(): RectRoom | null {
  const session = useSession();
  useDocRevision(session);
  const ids = useSelectionIds(session);
  return detectRectRoom(session.doc, ids);
}

export interface SelectedOpening {
  id: string;
  kind: string;
  /** normalized position along the wall */
  t: number;
  width: number;
}

/** the single selected window/door, recomputed per commit */
export function useSelectedOpening(): SelectedOpening | null {
  const session = useSession();
  useDocRevision(session);
  const ids = useSelectionIds(session);
  if (ids.length !== 1) return null;
  const e = session.doc.get(ids[0]);
  if (e instanceof WindowEntity || e instanceof DoorEntity) {
    return { id: e.id, kind: e.type, t: e.t, width: e.width };
  }
  return null;
}

export interface SelectedWalls {
  ids: EntityId[];
  /** common height across the selection, or null when they differ */
  height: number | null;
  /** common thickness across the selection, or null when they differ */
  thickness: number | null;
}

/** the wall selection (all selected must be walls), recomputed per commit */
export function useSelectedWalls(): SelectedWalls | null {
  const session = useSession();
  useDocRevision(session);
  const ids = useSelectionIds(session);
  if (ids.length === 0) return null;
  const walls: WallEntity[] = [];
  for (const id of ids) {
    const e = session.doc.get(id);
    if (!(e instanceof WallEntity)) return null; // mixed / non-wall
    walls.push(e);
  }
  const uniform = (vals: number[]) =>
    vals.every((v) => Math.abs(v - vals[0]) < 1e-6) ? vals[0] : null;
  return {
    ids: walls.map((w) => w.id),
    height: uniform(walls.map((w) => w.getHeight())),
    thickness: uniform(walls.map((w) => w.getThickness())),
  };
}

/**
 * Height + thickness editor for the selected wall(s). Numbers-first, applied by
 * the ✓ button (or Enter) in one undo step via WALL.SETPROPS. Setting thickness
 * detaches the wall from its assembly type (the raw number then wins); height
 * is always local. A mixed selection shows blank fields until you type a value.
 */
export function WallProps({ walls }: { walls: SelectedWalls }) {
  const session = useSession();
  const { ui } = useRuntime();
  const unit = useStoreValue(lengthUnit);
  const heightRef = useRef<HTMLInputElement>(null);
  const thickRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const params: Record<string, unknown> = { ids: walls.ids };
    const h = parseLength(heightRef.current?.value ?? '', unit);
    if (h !== null && h >= 0.1 && (walls.height === null || Math.abs(h - walls.height) > 1e-6)) {
      params['height'] = h;
    }
    const t = parseLength(thickRef.current?.value ?? '', unit);
    if (t !== null && t >= 0.01 && (walls.thickness === null || Math.abs(t - walls.thickness) > 1e-6)) {
      params['thickness'] = t;
    }
    if (params['height'] === undefined && params['thickness'] === undefined) {
      return;
    }
    try {
      session.dispatch('WALL.SETPROPS', params);
    } catch (err) {
      ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') apply();
    e.stopPropagation();
  };

  const hVal = walls.height !== null ? formatLengthValue(walls.height, unit) : '';
  const tVal =
    walls.thickness !== null ? formatLengthValue(walls.thickness, unit) : '';

  return (
    <div className="room-dims">
      <label className="room-dim">
        <span>Height</span>
        <input
          ref={heightRef}
          key={`h:${hVal}`}
          defaultValue={hVal}
          placeholder="—"
          inputMode="decimal"
          onKeyDown={onKeyDown}
        />
      </label>
      <label className="room-dim">
        <span>Thickness</span>
        <input
          ref={thickRef}
          key={`t:${tVal}`}
          defaultValue={tVal}
          placeholder="—"
          inputMode="decimal"
          onKeyDown={onKeyDown}
        />
      </label>
      <span className="room-dim-unit">{unit}</span>
      <button type="button" className="dim-apply" title="Apply" onClick={apply}>
        <IconCheck size={16} stroke={2} />
      </button>
    </div>
  );
}

/**
 * Numeric width/length editor for a rectangular room — the numbers-first way
 * to draw on a phone. Typing does NOT commit (no reliable blur/Enter on
 * touch); the ✓ button (or Enter) applies both fields in one undo step, in
 * the active unit (m/cm/mm, or an inline suffix).
 */
export function RoomDimensions({ room }: { room: RectRoom }) {
  const session = useSession();
  const unit = useStoreValue(lengthUnit);
  const width = room.maxX - room.minX;
  const height = room.maxY - room.minY;
  const widthRef = useRef<HTMLInputElement>(null);
  const heightRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const wm = parseLength(widthRef.current?.value ?? '', unit);
    const hm = parseLength(heightRef.current?.value ?? '', unit);
    const nw = wm !== null && wm >= 0.2 ? wm : width;
    const nh = hm !== null && hm >= 0.2 ? hm : height;
    if (Math.abs(nw - width) > 1e-6 || Math.abs(nh - height) > 1e-6) {
      resizeRectRoom(
        (name, params) => session.dispatch(name, params),
        room,
        nw,
        nh,
      );
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') apply();
    e.stopPropagation();
  };

  return (
    <div className="room-dims">
      <label className="room-dim">
        <span>Width</span>
        <input
          ref={widthRef}
          key={`w:${width}`}
          defaultValue={formatLengthValue(width, unit)}
          inputMode="decimal"
          onKeyDown={onKeyDown}
        />
      </label>
      <label className="room-dim">
        <span>Length</span>
        <input
          ref={heightRef}
          key={`h:${height}`}
          defaultValue={formatLengthValue(height, unit)}
          inputMode="decimal"
          onKeyDown={onKeyDown}
        />
      </label>
      <span className="room-dim-unit">{unit}</span>
      <button type="button" className="dim-apply" title="Apply" onClick={apply}>
        <IconCheck size={16} stroke={2} />
      </button>
    </div>
  );
}

/**
 * Numeric width + position editor for a selected window/door — openings by
 * numbers. Width → OPENING.RESIZE (meters, active unit); position → a 0–100%
 * slot via OPENING.MOVE. Applied by the ✓ button (or Enter), not on change.
 */
export function OpeningDimensions({ opening }: { opening: SelectedOpening }) {
  const session = useSession();
  const unit = useStoreValue(lengthUnit);
  const widthRef = useRef<HTMLInputElement>(null);
  const posRef = useRef<HTMLInputElement>(null);

  const apply = () => {
    const meters = parseLength(widthRef.current?.value ?? '', unit);
    if (
      meters !== null &&
      meters >= 0.1 &&
      Math.abs(meters - opening.width) > 1e-6
    ) {
      session.dispatch('OPENING.RESIZE', { id: opening.id, width: meters });
    }
    const pct = Number(posRef.current?.value ?? '');
    if (Number.isFinite(pct)) {
      const t = Math.min(1, Math.max(0, pct / 100));
      if (Math.abs(t - opening.t) > 1e-6)
        session.dispatch('OPENING.MOVE', { id: opening.id, t });
    }
  };
  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') apply();
    e.stopPropagation();
  };

  return (
    <div className="room-dims">
      <label className="room-dim">
        <span>Width</span>
        <input
          ref={widthRef}
          key={`w:${opening.width}`}
          defaultValue={formatLengthValue(opening.width, unit)}
          inputMode="decimal"
          onKeyDown={onKeyDown}
        />
      </label>
      <label className="room-dim">
        <span>Pos %</span>
        <input
          ref={posRef}
          key={`p:${opening.t}`}
          defaultValue={(opening.t * 100).toFixed(0)}
          inputMode="decimal"
          onKeyDown={onKeyDown}
        />
      </label>
      <span className="room-dim-unit">{unit}</span>
      <button type="button" className="dim-apply" title="Apply" onClick={apply}>
        <IconCheck size={16} stroke={2} />
      </button>
    </div>
  );
}

/**
 * Mobile bottom sheet: appears when a rectangular room (tap inside a room) or
 * a window/door is selected, with its numeric editor. Desktop shows the same
 * fields in the Properties panel; this sheet is hidden above 720px.
 */
export function RoomSheet() {
  const session = useSession();
  const room = useRectRoom();
  const opening = useSelectedOpening();
  const walls = useSelectedWalls();
  if (!room && !opening && !walls) return null;

  return (
    <div className="room-sheet">
      <div className="room-sheet-head">
        <span className="room-sheet-title">
          {room ? 'Room' : opening ? opening.kind : 'Wall'}
        </span>
        <button
          type="button"
          title="Deselect"
          onClick={() => session.selection.clear()}
        >
          <IconX size={15} stroke={1.75} />
        </button>
      </div>
      {room && <RoomDimensions room={room} />}
      {opening && <OpeningDimensions opening={opening} />}
      {/* height/thickness for a wall selection (also under a room's 4 walls) */}
      {walls && <WallProps walls={walls} />}
    </div>
  );
}
