import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';

const TOOLS = [
  { id: 'select', label: 'Sel', title: 'Select' },
  { id: 'line', label: '╱', title: 'Line (LINE)' },
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
          {tool.label}
        </button>
      ))}
    </aside>
  );
}
