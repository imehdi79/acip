import { IconArrowBackUp, IconCheck, IconX } from '@tabler/icons-react';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';
import { SketchTool } from '../tools/sketch-tool';

/**
 * Floating controls for the free-draw tool (desktop + mobile). Done recognizes
 * the pen strokes into walls; Undo drops the last stroke; Cancel leaves without
 * drawing anything. Only mounted while the sketch tool is active.
 */
export function SketchControls() {
  const { ui, tools } = useRuntime();
  const activeToolId = useStoreValue(ui.activeToolId);
  const tab = useStoreValue(ui.viewTab);
  const strokes = useStoreValue(ui.sketchStrokes);
  if (tab !== 'plan' || activeToolId !== 'sketch') return null;

  const sketch = tools.current instanceof SketchTool ? tools.current : null;

  return (
    <div className="sketch-controls">
      <span className="sketch-hint">
        {strokes > 0
          ? `${strokes} stroke${strokes === 1 ? '' : 's'} — draw more or Done`
          : 'Draw walls with the pen · two fingers pan/zoom'}
      </span>
      <div className="sketch-buttons">
        <button
          type="button"
          title="Cancel free draw"
          onClick={() => sketch?.cancel()}
        >
          <IconX size={16} stroke={1.75} />
        </button>
        <button
          type="button"
          title="Undo last stroke"
          disabled={strokes === 0}
          onClick={() => sketch?.undoStroke()}
        >
          <IconArrowBackUp size={16} stroke={1.75} />
        </button>
        <button
          type="button"
          className="sketch-done"
          title="Done — turn the sketch into walls"
          disabled={strokes === 0}
          onClick={() => sketch?.commit()}
        >
          <IconCheck size={16} stroke={2} />
          Done
        </button>
      </div>
    </div>
  );
}
