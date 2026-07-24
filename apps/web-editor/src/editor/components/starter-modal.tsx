import { IconX } from '@tabler/icons-react';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';
import { ROOM_PRESETS, addPreset, applyBlank, applyPreset } from '../presets';
import type { PresetWall, RoomPreset } from '../presets';

/**
 * Preset picker with two modes: 'replace' (first run / New — resets the doc,
 * offers a Blank option) and 'add' (sidebar — drops the room into the current
 * plan). The thumbnails are rendered from the presets' real wall geometry, so
 * what you see is what you get.
 */
export function StarterModal() {
  const session = useSession();
  const { ui, tools } = useRuntime();
  const open = useStoreValue(ui.starterOpen);
  const mode = useStoreValue(ui.starterMode);
  if (!open) return null;

  const adding = mode === 'add';
  const close = () => ui.starterOpen.set(false);

  const choose = (preset: RoomPreset) => {
    if (adding) {
      addPreset(session, preset);
      ui.appendLog(`Added room: ${preset.name}.`);
    } else {
      applyPreset(session, preset);
      ui.activeLevelId.set(null);
      ui.appendLog(`Started from preset: ${preset.name}.`);
    }
    close();
  };

  const blank = () => {
    applyBlank(session);
    ui.activeLevelId.set(null);
    ui.appendLog('New blank drawing.');
    close();
  };

  const freeDraw = () => {
    applyBlank(session);
    ui.activeLevelId.set(null);
    tools.useById('sketch');
    ui.appendLog('Free draw — sketch your walls, then press Done.');
    close();
  };

  return (
    <div className="starter-overlay" onClick={close}>
      <div
        className="starter-modal"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="starter-head">
          <h2>{adding ? 'Add a room to the plan' : 'Start a new drawing'}</h2>
          <button type="button" title="Close" onClick={close}>
            <IconX size={18} stroke={1.75} />
          </button>
        </header>
        <p className="starter-sub">
          {adding
            ? 'The room is placed next to your existing walls — one undo step.'
            : 'Pick a starting layout — edit it or keep building right away.'}
        </p>
        <div className="starter-grid">
          {ROOM_PRESETS.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className="preset-card"
              onClick={() => choose(preset)}
            >
              <PresetPreview walls={preset.walls} />
              <span className="preset-name">{preset.name}</span>
              <span className="preset-dims">{preset.dims}</span>
            </button>
          ))}
          {!adding && (
            <button type="button" className="preset-card" onClick={freeDraw}>
              <FreeDrawPreview />
              <span className="preset-name">Free draw</span>
              <span className="preset-dims">Sketch walls by hand</span>
            </button>
          )}
          {!adding && (
            <button type="button" className="preset-card" onClick={blank}>
              <BlankPreview />
              <span className="preset-name">Blank</span>
              <span className="preset-dims">Empty canvas</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** SVG thumbnail from wall centerlines; world +y up → SVG y down (negate y) */
function PresetPreview({ walls }: { walls: PresetWall[] }) {
  const pts = walls.flatMap((w) => [w.a, w.b]);
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const pad = 0.9;
  const viewBox = `${minX - pad} ${-maxY - pad} ${maxX - minX + pad * 2} ${
    maxY - minY + pad * 2
  }`;
  return (
    <svg
      className="preset-svg"
      viewBox={viewBox}
      preserveAspectRatio="xMidYMid meet"
    >
      {walls.map((w, i) => (
        <line key={i} x1={w.a.x} y1={-w.a.y} x2={w.b.x} y2={-w.b.y} />
      ))}
    </svg>
  );
}

function BlankPreview() {
  return (
    <svg
      className="preset-svg blank"
      viewBox="0 0 10 8"
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x="1" y="1" width="8" height="6" rx="0.3" className="blank-rect" />
      <line x1="5" y1="3" x2="5" y2="5" />
      <line x1="4" y1="4" x2="6" y2="4" />
    </svg>
  );
}

/** a hand-drawn scribble that resolves into a room — the free-draw promise */
function FreeDrawPreview() {
  return (
    <svg
      className="preset-svg sketch"
      viewBox="0 0 10 8"
      preserveAspectRatio="xMidYMid meet"
    >
      <path
        className="sketch-ink"
        d="M1.6 1.4 C3 1.1 6.5 1.3 8.3 1.5 C8.5 3 8.6 5 8.4 6.6 C6 6.8 3.4 6.7 1.7 6.5 C1.5 4.8 1.5 3.1 1.6 1.4 Z"
      />
    </svg>
  );
}
