import { IconRulerMeasure, IconScan, IconX } from '@tabler/icons-react';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';

/**
 * Floating card over the viewport while a plan underlay is loaded: opacity,
 * two-point scale calibration, region tracing by the agent, and removal.
 */
export function UnderlayControls() {
  const { ui, tools } = useRuntime();
  const underlay = useStoreValue(ui.underlay);
  const activeToolId = useStoreValue(ui.activeToolId);
  if (!underlay) return null;

  return (
    <div className="underlay-card">
      <span className="underlay-title">Underlay</span>
      <input
        type="range"
        min="0.1"
        max="1"
        step="0.05"
        value={underlay.opacity}
        title="Opacity"
        onChange={(e) =>
          ui.underlay.set({ ...underlay, opacity: Number(e.target.value) })
        }
      />
      <button
        type="button"
        className={activeToolId === 'calibrate' ? 'active' : ''}
        title="Calibrate scale — click two points a known distance apart"
        onClick={() => tools.useById('calibrate')}
      >
        <IconRulerMeasure size={15} stroke={1.75} />
      </button>
      <button
        type="button"
        className={activeToolId === 'trace' ? 'active' : ''}
        title="Trace a region — the agent draws the walls it sees"
        onClick={() => tools.useById('trace')}
      >
        <IconScan size={15} stroke={1.75} />
      </button>
      <button
        type="button"
        title="Remove underlay"
        onClick={() => ui.underlay.set(null)}
      >
        <IconX size={15} stroke={1.75} />
      </button>
    </div>
  );
}
