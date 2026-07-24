import { useRef, useState } from 'react';
import { WallEntity } from '@acip/editor-core';
import type { EntityId, Point } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision, useSelectionIds } from '../hooks';
import { useStoreValue } from '../store';
import { formatLength, formatLengthValue, lengthUnit, parseLength } from '../units';
import { detectRectRoom, resizeRectRoom, setWallLength } from '../rooms';

/** most walls a single sketch shows chips for — a guard against clutter */
const MAX_CHIPS = 16;

interface WallChip {
  id: EntityId;
  mid: Point;
  length: number;
  horizontal: boolean;
}

/**
 * "A floating button on each detected wall." After free-draw, each recognized
 * wall gets a small length chip at its midpoint; tap it to type an exact
 * length. For a clean rectangular room the edit resizes the room (keeps it
 * square); otherwise it slides that wall's far endpoint, dragging joined
 * corners along. Positioned from the live camera, so chips track pan/zoom.
 */
export function SketchDimensions() {
  const session = useSession();
  const { ui } = useRuntime();
  useDocRevision(session);
  const selection = useSelectionIds(session);
  const sketchWalls = useStoreValue(ui.sketchWalls);
  const camera = useStoreValue(ui.camera);
  const tab = useStoreValue(ui.viewTab);
  const activeToolId = useStoreValue(ui.activeToolId);
  const unit = useStoreValue(lengthUnit);
  const [editing, setEditing] = useState<EntityId | null>(null);
  const [draft, setDraft] = useState('');
  // one edit session: guards against Enter+blur double-apply and Escape cancel
  const edit = useRef<{ committed: boolean; cancelled: boolean } | null>(null);

  if (tab !== 'plan' || activeToolId !== 'select') return null;

  // chips only for freshly-sketched walls that are still selected
  const selected = new Set(selection);
  const ids = sketchWalls.filter((id) => selected.has(id as EntityId));
  if (ids.length === 0 || ids.length > MAX_CHIPS) return null;

  const chips: WallChip[] = [];
  for (const id of ids) {
    const e = session.doc.get(id as EntityId);
    if (!(e instanceof WallEntity)) continue;
    const { a, b } = e.getBaseline();
    chips.push({
      id: e.id,
      mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      length: e.getLength(),
      horizontal: Math.abs(a.y - b.y) <= Math.abs(a.x - b.x),
    });
  }
  if (chips.length === 0) return null;

  const toScreen = (p: Point) => ({
    x: camera.offsetX + p.x * camera.scale,
    y: camera.offsetY - p.y * camera.scale,
  });

  const apply = (chip: WallChip) => {
    const state = edit.current;
    setEditing(null);
    if (!state || state.committed || state.cancelled) return;
    state.committed = true;
    const meters = parseLength(draft, unit);
    if (meters === null || meters < 0.1 || Math.abs(meters - chip.length) < 1e-4) {
      return;
    }
    const dispatch = (name: string, params: unknown) =>
      session.dispatch(name, params);
    try {
      const room = detectRectRoom(session.doc, session.selection.list());
      if (room && room.walls.some((w) => w.id === chip.id)) {
        // keep the room a rectangle: one dimension follows the wall's axis
        const width = room.maxX - room.minX;
        const height = room.maxY - room.minY;
        if (chip.horizontal) resizeRectRoom(dispatch, room, meters, height);
        else resizeRectRoom(dispatch, room, width, meters);
      } else {
        setWallLength(dispatch, session.doc, chip.id, meters);
      }
    } catch (err) {
      ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <div className="sketch-dims">
      {chips.map((chip) => {
        const s = toScreen(chip.mid);
        const isEditing = editing === chip.id;
        return (
          <div
            key={chip.id}
            className="sketch-dim-chip"
            style={{ left: `${s.x}px`, top: `${s.y}px` }}
          >
            {isEditing ? (
              <input
                autoFocus
                className="sketch-dim-input"
                inputMode="decimal"
                defaultValue={formatLengthValue(chip.length, unit)}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') apply(chip);
                  if (e.key === 'Escape') {
                    if (edit.current) edit.current.cancelled = true;
                    setEditing(null);
                  }
                  e.stopPropagation();
                }}
                onBlur={() => apply(chip)}
              />
            ) : (
              <button
                type="button"
                title="Set this wall's length"
                onClick={() => {
                  setDraft(formatLengthValue(chip.length, unit));
                  edit.current = { committed: false, cancelled: false };
                  setEditing(chip.id);
                }}
              >
                {formatLength(chip.length, unit)}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}
