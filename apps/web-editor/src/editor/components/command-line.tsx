import { useEffect, useRef, useState } from 'react';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';

export function CommandLine() {
  const session = useSession();
  const { ui, tools } = useRuntime();
  const prompt = useStoreValue(ui.prompt);
  const log = useStoreValue(ui.log);
  const [input, setInput] = useState('');
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo(0, logRef.current.scrollHeight);
  }, [log]);

  const run = (raw: string) => {
    const command = raw.trim().toUpperCase();
    if (!command) return;
    ui.appendLog(`> ${command}`, 'echo');
    try {
      switch (command) {
        case 'LINE':
        case 'L':
          tools.useById('line');
          break;
        case 'ERASE':
        case 'E': {
          const ids = session.selection.list();
          if (ids.length === 0) {
            ui.appendLog('Nothing selected.', 'error');
            break;
          }
          const count = session.dispatch<number>('ENTITY.ERASE', { ids });
          session.selection.clear();
          ui.appendLog(`Erased ${count} entities.`);
          break;
        }
        case 'UNDO':
        case 'U':
          if (!session.undo()) ui.appendLog('Nothing to undo.');
          break;
        case 'REDO':
          if (!session.redo()) ui.appendLog('Nothing to redo.');
          break;
        default:
          ui.appendLog(`Unknown command: ${command}`, 'error');
      }
    } catch (err) {
      ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
    }
  };

  return (
    <div className="command-line">
      <div className="command-log" ref={logRef}>
        {log.map((entry, i) => (
          <div key={i} className={`log-${entry.kind}`}>
            {entry.text}
          </div>
        ))}
      </div>
      <div className="command-input-row">
        <span className="command-prompt">{prompt}</span>
        <input
          value={input}
          placeholder="Command (LINE, ERASE, UNDO, REDO)…"
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              run(input);
              setInput('');
            }
            e.stopPropagation();
          }}
        />
      </div>
    </div>
  );
}
