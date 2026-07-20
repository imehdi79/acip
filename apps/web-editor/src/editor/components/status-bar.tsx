import { IconCrosshair, IconMagnet, IconStack2 } from '@tabler/icons-react';
import type { LevelId } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision } from '../hooks';
import { useStoreValue } from '../store';
import {
  LENGTH_UNITS,
  formatLength,
  formatLengthValue,
  lengthUnit,
  setLengthUnit,
} from '../units';
import type { LengthUnit } from '../units';

export function StatusBar() {
  const session = useSession();
  const { ui } = useRuntime();
  const coords = useStoreValue(ui.coords);
  const activeLevelId = useStoreValue(ui.activeLevelId);
  const unit = useStoreValue(lengthUnit);
  useDocRevision(session);

  const levels = session.doc.levels.list();

  return (
    <footer className="status-bar">
      <span className="coords">
        <IconCrosshair size={14} stroke={1.75} />
        {coords
          ? `${formatLengthValue(coords.x, unit)}, ${formatLengthValue(coords.y, unit)} ${unit}`
          : '—'}
      </span>
      <span className="status-item">
        <IconMagnet size={14} stroke={1.75} />
        OSNAP END MID
      </span>
      <label className="level-picker">
        <IconStack2 size={14} stroke={1.75} />
        Level
        <select
          value={activeLevelId ?? ''}
          onChange={(e) =>
            ui.activeLevelId.set((e.target.value || null) as LevelId | null)
          }
        >
          <option value="">All</option>
          {levels.map((level) => (
            <option key={level.id} value={level.id}>
              {level.name} ({formatLength(level.elevation, unit)})
            </option>
          ))}
        </select>
      </label>
      <label className="unit-picker" title="Display unit for lengths">
        <select
          value={unit}
          onChange={(e) => setLengthUnit(e.target.value as LengthUnit)}
        >
          {LENGTH_UNITS.map((u) => (
            <option key={u} value={u}>
              {u}
            </option>
          ))}
        </select>
      </label>
    </footer>
  );
}
