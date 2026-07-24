import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';
import { unitLabel } from '../units';

/**
 * AutoCAD-style dynamic input: while drawing, the length you type shows in a
 * small chip that follows the cursor. Enter places the point at that exact
 * length along the aimed direction. Purely a readout — the tool owns the value.
 */
export function DynamicInput() {
  const { ui } = useRuntime();
  const draft = useStoreValue(ui.draftLength);
  const coords = useStoreValue(ui.coords);
  const camera = useStoreValue(ui.camera);
  const tab = useStoreValue(ui.viewTab);
  if (tab !== 'plan' || draft === null || !coords) return null;

  const x = camera.offsetX + coords.x * camera.scale + 16;
  const y = camera.offsetY - coords.y * camera.scale - 28;

  return (
    <div className="dynamic-input" style={{ left: `${x}px`, top: `${y}px` }}>
      <span className="dynamic-value">
        {draft}
        <span className="dynamic-caret" />
      </span>
      <span className="dynamic-unit">{unitLabel()}</span>
      <span className="dynamic-hint">Enter</span>
    </div>
  );
}
