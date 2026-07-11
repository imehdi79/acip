import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';

export function StatusBar() {
  const { ui } = useRuntime();
  const coords = useStoreValue(ui.coords);

  return (
    <footer className="status-bar">
      <span className="coords">
        {coords ? `${coords.x.toFixed(2)}, ${coords.y.toFixed(2)}` : '—'}
      </span>
      <span>OSNAP END MID</span>
      <span>Level —</span>
      <span>m</span>
    </footer>
  );
}
