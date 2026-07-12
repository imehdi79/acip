import { IconArrowBackUp, IconArrowForwardUp, IconCube, IconGrid4x4 } from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useDocRevision } from '../hooks';
import { useStoreValue } from '../store';
import type { ViewTab } from '../ui-state';

const TABS: { id: ViewTab; icon: Icon; label: string }[] = [
  { id: 'plan', icon: IconGrid4x4, label: 'Plan' },
  { id: '3d', icon: IconCube, label: '3D' },
];

export function TopBar() {
  const session = useSession();
  const { ui } = useRuntime();
  useDocRevision(session);
  const activeTab = useStoreValue(ui.viewTab);

  return (
    <header className="top-bar">
      <span className="brand">acip editor</span>
      <div className="top-bar-group">
        <button
          type="button"
          disabled={!session.history.canUndo}
          onClick={() => session.undo()}
          title="Undo (Ctrl+Z)"
        >
          <IconArrowBackUp size={16} stroke={1.75} />
          Undo
        </button>
        <button
          type="button"
          disabled={!session.history.canRedo}
          onClick={() => session.redo()}
          title="Redo (Ctrl+Y)"
        >
          <IconArrowForwardUp size={16} stroke={1.75} />
          Redo
        </button>
      </div>
      <div className="top-bar-group tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={activeTab === tab.id ? 'active' : ''}
            onClick={() => ui.viewTab.set(tab.id)}
          >
            <tab.icon size={16} stroke={1.75} />
            {tab.label}
          </button>
        ))}
      </div>
    </header>
  );
}
