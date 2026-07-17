import {
  IconCircle,
  IconDoor,
  IconLine,
  IconPointer,
  IconRuler2,
  IconTimeline,
  IconVectorSpline,
  IconWall,
  IconWindow,
} from '@tabler/icons-react';
import type { Icon } from '@tabler/icons-react';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';

const TOOLS: { id: string; icon: Icon; title: string }[] = [
  { id: 'select', icon: IconPointer, title: 'Select' },
  { id: 'line', icon: IconLine, title: 'Line (LINE)' },
  { id: 'circle', icon: IconCircle, title: 'Circle (CIRCLE)' },
  { id: 'arc', icon: IconVectorSpline, title: 'Arc (ARC)' },
  { id: 'polyline', icon: IconTimeline, title: 'Polyline (PLINE)' },
  { id: 'wall', icon: IconWall, title: 'Wall (WALL)' },
  { id: 'window', icon: IconWindow, title: 'Window (WINDOW)' },
  { id: 'door', icon: IconDoor, title: 'Door (DOOR)' },
  { id: 'dimension', icon: IconRuler2, title: 'Dimension (DIM)' },
];

export function ToolPalette() {
  const { ui, tools } = useRuntime();
  const activeId = useStoreValue(ui.activeToolId);

  return (
    <aside className="tool-palette">
      {TOOLS.map((tool) => (
        <button
          key={tool.id}
          type="button"
          title={tool.title}
          className={activeId === tool.id ? 'active' : ''}
          onClick={() => tools.useById(tool.id)}
        >
          <tool.icon size={20} stroke={1.75} />
        </button>
      ))}
    </aside>
  );
}
