import type { DocumentData, EditorSession } from '@acip/editor-core';
import type { EditorUi } from './ui-state';

const AUTOSAVE_KEY = 'acip.autosave';

export function saveToFile(session: EditorSession, ui: EditorUi): void {
  const json = JSON.stringify(session.save(), null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'drawing.acip.json';
  anchor.click();
  URL.revokeObjectURL(url);
  ui.appendLog(`Saved ${session.doc.count} entities to drawing.acip.json.`);
}

export function openFromFile(session: EditorSession, ui: EditorUi): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = '.json,application/json';
  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as DocumentData;
      if (data.formatVersion !== 1) {
        throw new Error(`unsupported format version ${String(data.formatVersion)}`);
      }
      session.open(data);
      ui.activeLevelId.set(null); // the old active level does not exist here
      ui.appendLog(`Opened ${file.name} — ${session.doc.count} entities.`);
    } catch (err) {
      ui.appendLog(
        `Could not open file: ${err instanceof Error ? err.message : String(err)}`,
        'error',
      );
    }
  };
  input.click();
}

/**
 * Restore the last autosave (if any), then persist on every committed
 * change, debounced. Called once at session creation — before the runtime
 * seeds its demo catalog, so a restored document keeps its own catalog.
 */
export function setupAutosave(session: EditorSession): void {
  try {
    const raw = localStorage.getItem(AUTOSAVE_KEY);
    if (raw) {
      const data = JSON.parse(raw) as DocumentData;
      if (data.formatVersion === 1 && data.entities.length > 0) {
        session.open(data);
      }
    }
  } catch {
    // corrupted autosave — start fresh rather than block the editor
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  session.doc.events.on('change', () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, JSON.stringify(session.save()));
      } catch {
        // storage full or unavailable — saving to file still works
      }
    }, 500);
  });
}
