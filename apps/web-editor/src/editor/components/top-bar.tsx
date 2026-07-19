import {
  IconArrowBackUp,
  IconArrowForwardUp,
  IconCube,
  IconDeviceFloppy,
  IconFile,
  IconFolderOpen,
  IconGrid4x4,
  IconHash,
  IconPhoto,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { useRef } from 'react';
import { loadUnderlayFromFile } from '../underlay';
import { useSession } from '../session-context';
import { useRuntime, seedCatalog } from '../runtime';
import { useDocRevision } from '../hooks';
import { useStoreValue } from '../store';
import { openFromFile, saveToFile } from '../files';
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
  const showMarks = useStoreValue(ui.showMarks);
  const underlayFileRef = useRef<HTMLInputElement>(null);

  return (
    <header className="top-bar">
      <span className="brand">acip editor</span>
      <div className="top-bar-group">
        <button
          type="button"
          title="New drawing"
          onClick={() => {
            if (
              session.doc.count > 0 &&
              !window.confirm(
                'Start a new drawing? The current one stays in autosave until you draw.',
              )
            ) {
              return;
            }
            session.newDocument();
            seedCatalog(session);
            ui.activeLevelId.set(null);
            ui.appendLog('New drawing.');
          }}
        >
          <IconFile size={16} stroke={1.75} />
          New
        </button>
        <button
          type="button"
          title="Open .acip.json"
          onClick={() => openFromFile(session, ui)}
        >
          <IconFolderOpen size={16} stroke={1.75} />
          Open
        </button>
        <button
          type="button"
          title="Save to file"
          onClick={() => saveToFile(session, ui)}
        >
          <IconDeviceFloppy size={16} stroke={1.75} />
          Save
        </button>
      </div>
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
      <div className="top-bar-group">
        <button
          type="button"
          className={showMarks ? 'active' : ''}
          title="Show entity marks (W3, D1) — how you and the agent name things"
          onClick={() => ui.showMarks.set(!showMarks)}
        >
          <IconHash size={16} stroke={1.75} />
          Marks
        </button>
        <input
          ref={underlayFileRef}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) loadUnderlayFromFile(file, ui);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          title="Load a plan image to trace over"
          onClick={() => underlayFileRef.current?.click()}
        >
          <IconPhoto size={16} stroke={1.75} />
          Underlay
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
