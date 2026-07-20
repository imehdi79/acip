import { IconX } from '@tabler/icons-react';
import { DoorEntity, WindowEntity } from '@acip/editor-core';
import { useSession } from '../session-context';
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

const commitOnEnter = (e: React.KeyboardEvent<HTMLInputElement>) => {
  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
  e.stopPropagation();
};

/**
 * Numeric width/length editor for a rectangular room — the numbers-first way
 * to draw on a phone. Shared by the desktop Properties panel and the mobile
 * bottom sheet; every edit resizes the room in one undo step, in the active
 * unit (m/cm/mm, or an inline suffix).
 */
export function RoomDimensions({ room }: { room: RectRoom }) {
  const session = useSession();
  const unit = useStoreValue(lengthUnit);
  const width = room.maxX - room.minX;
  const height = room.maxY - room.minY;

  const commit = (which: 'w' | 'h', text: string) => {
    const meters = parseLength(text, unit);
    if (meters === null || meters < 0.2) return; // ignore junk / too small
    resizeRectRoom(
      (name, params) => session.dispatch(name, params),
      room,
      which === 'w' ? meters : width,
      which === 'h' ? meters : height,
    );
  };

  return (
    <div className="room-dims">
      <label className="room-dim">
        <span>Width</span>
        <input
          key={`w:${width}`}
          defaultValue={formatLengthValue(width, unit)}
          inputMode="decimal"
          onKeyDown={commitOnEnter}
          onBlur={(e) => commit('w', e.target.value)}
        />
      </label>
      <label className="room-dim">
        <span>Length</span>
        <input
          key={`h:${height}`}
          defaultValue={formatLengthValue(height, unit)}
          inputMode="decimal"
          onKeyDown={commitOnEnter}
          onBlur={(e) => commit('h', e.target.value)}
        />
      </label>
      <span className="room-dim-unit">{unit}</span>
    </div>
  );
}

/**
 * Numeric width + position editor for a selected window/door — openings by
 * numbers. Width dispatches OPENING.RESIZE (meters, active unit); position is
 * a 0–100% slot along the wall via OPENING.MOVE. One undo step each.
 */
export function OpeningDimensions({ opening }: { opening: SelectedOpening }) {
  const session = useSession();
  const unit = useStoreValue(lengthUnit);

  const commitWidth = (text: string) => {
    const meters = parseLength(text, unit);
    if (meters === null || meters < 0.1) return;
    session.dispatch('OPENING.RESIZE', { id: opening.id, width: meters });
  };
  const commitPos = (text: string) => {
    const pct = Number(text);
    if (!Number.isFinite(pct)) return;
    const t = Math.min(1, Math.max(0, pct / 100));
    session.dispatch('OPENING.MOVE', { id: opening.id, t });
  };

  return (
    <div className="room-dims">
      <label className="room-dim">
        <span>Width</span>
        <input
          key={`w:${opening.width}`}
          defaultValue={formatLengthValue(opening.width, unit)}
          inputMode="decimal"
          onKeyDown={commitOnEnter}
          onBlur={(e) => commitWidth(e.target.value)}
        />
      </label>
      <label className="room-dim">
        <span>Pos %</span>
        <input
          key={`p:${opening.t}`}
          defaultValue={(opening.t * 100).toFixed(0)}
          inputMode="decimal"
          onKeyDown={commitOnEnter}
          onBlur={(e) => commitPos(e.target.value)}
        />
      </label>
      <span className="room-dim-unit">{unit}</span>
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
  if (!room && !opening) return null;

  return (
    <div className="room-sheet">
      <div className="room-sheet-head">
        <span className="room-sheet-title">
          {room ? 'Room' : opening?.kind}
        </span>
        <button
          type="button"
          title="Deselect"
          onClick={() => session.selection.clear()}
        >
          <IconX size={15} stroke={1.75} />
        </button>
      </div>
      {room ? (
        <RoomDimensions room={room} />
      ) : (
        opening && <OpeningDimensions opening={opening} />
      )}
    </div>
  );
}
