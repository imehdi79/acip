import { IconX } from '@tabler/icons-react';
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
  return detectRectRoom(session, ids);
}

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
      session,
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
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
          onBlur={(e) => commit('w', e.target.value)}
        />
      </label>
      <label className="room-dim">
        <span>Length</span>
        <input
          key={`h:${height}`}
          defaultValue={formatLengthValue(height, unit)}
          inputMode="decimal"
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            e.stopPropagation();
          }}
          onBlur={(e) => commit('h', e.target.value)}
        />
      </label>
      <span className="room-dim-unit">{unit}</span>
    </div>
  );
}

/**
 * Mobile bottom sheet: appears when a rectangular room is selected (tap inside
 * a room to select it). The desktop shows the same fields in the Properties
 * panel instead — this sheet is hidden above 720px.
 */
export function RoomSheet() {
  const session = useSession();
  const room = useRectRoom();
  if (!room) return null;

  return (
    <div className="room-sheet">
      <div className="room-sheet-head">
        <span className="room-sheet-title">Room</span>
        <button
          type="button"
          title="Deselect"
          onClick={() => session.selection.clear()}
        >
          <IconX size={15} stroke={1.75} />
        </button>
      </div>
      <RoomDimensions room={room} />
    </div>
  );
}
