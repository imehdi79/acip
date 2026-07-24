import { useRef, useState } from 'react';
import { detectSpaces } from '@acip/editor-core';
import type { Point } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision } from '../hooks';
import { useStoreValue } from '../store';
import { roomNameKey, roomNames, setRoomName } from '../room-names';

/**
 * Editable room marks on the plan (part of the Marks system, toggled with the
 * "Marks" button). Each detected room shows R1, R2… — click it to rename the
 * room ("Bathroom", "WC"…). Names live in the room-names store (keyed by the
 * boundary walls), shared with the Rooms list in the panel. Sits just above the
 * room's area label, positioned from the live camera.
 */
export function RoomMarks() {
  const session = useSession();
  const { ui } = useRuntime();
  useDocRevision(session);
  const showMarks = useStoreValue(ui.showMarks);
  const tab = useStoreValue(ui.viewTab);
  const activeLevelId = useStoreValue(ui.activeLevelId);
  const camera = useStoreValue(ui.camera);
  const names = useStoreValue(roomNames);
  const [editing, setEditing] = useState<string | null>(null);
  const edit = useRef<{ committed: boolean; cancelled: boolean } | null>(null);
  const draft = useRef('');

  if (tab !== 'plan' || !showMarks) return null;
  const spaces = detectSpaces(session.doc, activeLevelId);
  if (spaces.length === 0) return null;

  const toScreen = (p: Point) => ({
    x: camera.offsetX + p.x * camera.scale,
    y: camera.offsetY - p.y * camera.scale,
  });

  const apply = (key: string) => {
    const state = edit.current;
    setEditing(null);
    if (!state || state.committed || state.cancelled) return;
    state.committed = true;
    setRoomName(key, draft.current);
  };

  return (
    <div className="room-marks">
      {spaces.map((space, i) => {
        const key = roomNameKey(space.boundaryWallIds);
        const name = names[key] ?? '';
        const label = name || `R${i + 1}`;
        const s = toScreen(space.labelPoint);
        const isEditing = editing === key;
        return (
          <div
            key={space.key}
            className="room-mark"
            style={{ left: `${s.x}px`, top: `${s.y - 18}px` }}
          >
            {isEditing ? (
              <input
                autoFocus
                className="room-mark-input"
                defaultValue={name}
                placeholder={`R${i + 1}`}
                onChange={(e) => {
                  draft.current = e.target.value;
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply(key);
                  if (e.key === 'Escape') {
                    if (edit.current) edit.current.cancelled = true;
                    setEditing(null);
                  }
                  e.stopPropagation();
                }}
                onBlur={() => apply(key)}
              />
            ) : (
              <button
                type="button"
                className={name ? 'room-mark-btn named' : 'room-mark-btn'}
                title="Rename this room"
                onClick={() => {
                  draft.current = name;
                  edit.current = { committed: false, cancelled: false };
                  setEditing(key);
                }}
              >
                {label}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
