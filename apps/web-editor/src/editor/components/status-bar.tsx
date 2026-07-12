import { IconCrosshair, IconMagnet, IconStack2 } from '@tabler/icons-react';
import type { LevelId } from '@acip/editor-core';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision } from '../hooks';
import { useStoreValue } from '../store';

export function StatusBar() {
  const session = useSession();
  const { ui } = useRuntime();
  const coords = useStoreValue(ui.coords);
  const activeLevelId = useStoreValue(ui.activeLevelId);
  useDocRevision(session);

  const levels = session.doc.levels.list();

  return (
    <footer className="status-bar">
      <span className="coords">
        <IconCrosshair size={14} stroke={1.75} />
        {coords ? `${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}` : '—'}
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
          onChange={(e) => ui.activeLevelId.set((e.target.value || null) as LevelId | null)}
        >
          <option value="">All</option>
          {levels.map((level) => (
            <option key={level.id} value={level.id}>
              {level.name} ({level.elevation.toFixed(2)}m)
            </option>
          ))}
        </select>
      </label>
      <span>m</span>
    </footer>
  );
}
