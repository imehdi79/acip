import { useEffect, useRef, useState } from 'react';
import { IconKey, IconSparkles } from '@tabler/icons-react';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';
import type { AgentProvider } from '../agent';
import {
  PROVIDERS,
  getApiKey,
  getProvider,
  providerInfo,
  resolvedModel,
  runDrafter,
  setApiKey,
  setModel,
  setProvider,
} from '../agent';

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
        case 'CIRCLE':
        case 'C':
          tools.useById('circle');
          break;
        case 'ARC':
        case 'A':
          tools.useById('arc');
          break;
        case 'POLYLINE':
        case 'PLINE':
        case 'PL':
          tools.useById('polyline');
          break;
        case 'WALL':
        case 'W':
          tools.useById('wall');
          break;
        case 'WINDOW':
        case 'WIN':
          tools.useById('window');
          break;
        case 'DOOR':
        case 'D':
          tools.useById('door');
          break;
        case 'SLAB':
          tools.useById('slab');
          break;
        case 'STAIR':
          tools.useById('stair');
          break;
        case 'SLABAUTO': {
          const levelId = ui.activeLevelId.get();
          const slabTypes = session.doc.types.list('slab');
          const result = session.dispatch<{
            removed: number;
            created: number;
            totalArea: number;
          }>('SLAB.AUTO', {
            ...(levelId ? { levelId } : {}),
            ...(slabTypes.length > 0 ? { typeId: slabTypes[0].id } : {}),
          });
          ui.appendLog(
            `Slabs: ${result.created} placed, ${result.totalArea.toFixed(1)} m²` +
              (result.removed > 0 ? ` (${result.removed} replaced).` : '.'),
          );
          break;
        }
        case 'ROOFAUTO': {
          const levelId = ui.activeLevelId.get();
          const roofTypes = session.doc.types.list('roof');
          const result = session.dispatch<{
            removed: number;
            created: number;
            planArea: number;
          }>('ROOF.AUTO', {
            ...(levelId ? { levelId } : {}),
            ...(roofTypes.length > 0 ? { typeId: roofTypes[0].id } : {}),
          });
          ui.appendLog(
            `Roofs: ${result.created} placed, ${result.planArea.toFixed(1)} m² plan` +
              (result.removed > 0 ? ` (${result.removed} replaced).` : '.'),
          );
          break;
        }
        case 'FINISHAUTO': {
          const levelId = ui.activeLevelId.get();
          const tile = session.doc.materials.list().find((m) => m.costCode === 'wall-tile');
          if (!tile) {
            ui.appendLog('No tile material in the catalog.', 'error');
            break;
          }
          const result = session.dispatch<{
            removed: number;
            created: number;
            totalArea: number;
          }>('FINISH.AUTO', {
            materialId: tile.id,
            topHeight: 1.2,
            ...(levelId ? { levelId } : {}),
          });
          ui.appendLog(
            `Finishes: ${result.created} faces, ${result.totalArea.toFixed(1)} m²` +
              (result.removed > 0 ? ` (${result.removed} replaced).` : '.'),
          );
          break;
        }
        case 'FLOORAUTO': {
          const levelId = ui.activeLevelId.get();
          const floorTile = session.doc.materials.list().find((m) => m.costCode === 'floor-tile');
          if (!floorTile) {
            ui.appendLog('No floor material in the catalog.', 'error');
            break;
          }
          const result = session.dispatch<{
            removed: number;
            created: number;
            totalArea: number;
          }>('FLOORFINISH.AUTO', {
            materialId: floorTile.id,
            ...(levelId ? { levelId } : {}),
          });
          ui.appendLog(
            result.created === 0
              ? 'No slabs to finish — run SLABAUTO first.'
              : `Floor finishes: ${result.created} slabs, ${result.totalArea.toFixed(1)} m²` +
                  (result.removed > 0 ? ` (${result.removed} replaced).` : '.'),
          );
          break;
        }
        case 'DIM':
          tools.useById('dimension');
          break;
        case 'DIMAUTO': {
          const levelId = ui.activeLevelId.get();
          const result = session.dispatch<{ removed: number; created: number }>('DIM.AUTO', {
            ...(levelId ? { levelId } : {}),
          });
          ui.appendLog(
            `Dimensions: ${result.created} placed` +
              (result.removed > 0 ? `, ${result.removed} replaced.` : '.'),
          );
          break;
        }
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
          placeholder="Command (LINE, WALL, WINDOW, DOOR, ERASE, UNDO, REDO)…"
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
      <AgentRow />
    </div>
  );
}

function AgentRow() {
  const session = useSession();
  const { ui } = useRuntime();
  const busy = useStoreValue(ui.agentBusy);
  const [prompt, setPrompt] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProviderState] = useState<AgentProvider>(getProvider);
  const [key, setKey] = useState(() => getApiKey(getProvider()));
  const [model, setModelState] = useState(() => resolvedModel(getProvider()));

  const info = providerInfo(provider);

  const submit = () => {
    const text = prompt.trim();
    if (!text || busy) return;
    setPrompt('');
    void runDrafter(session, ui, text);
  };

  // switching provider loads that provider's stored key and effective model
  const switchProvider = (next: AgentProvider) => {
    setProviderState(next);
    setProvider(next);
    setKey(getApiKey(next));
    setModelState(resolvedModel(next));
  };

  const saveSettings = () => {
    setApiKey(provider, key);
    setModel(provider, model);
    setShowSettings(false);
    ui.appendLog(
      key.trim()
        ? `${info.label} key saved (this browser only), model ${model}.`
        : `${info.label} key cleared.`,
    );
  };

  return (
    <div className="agent-row">
      <IconSparkles size={16} stroke={1.75} className={busy ? 'agent-icon busy' : 'agent-icon'} />
      <input
        value={prompt}
        disabled={busy}
        placeholder={
          busy
            ? 'Agent is drawing…'
            : `Ask ${info.label} — e.g. "draw a 6 by 4 m room with a door"`
        }
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          e.stopPropagation();
        }}
      />
      {showSettings && (
        <>
          <select
            className="agent-provider"
            value={provider}
            onChange={(e) => switchProvider(e.target.value as AgentProvider)}
          >
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select
            className="agent-provider agent-model"
            value={model}
            title="Model"
            onChange={(e) => setModelState(e.target.value)}
          >
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <input
            type="password"
            className="key-input"
            placeholder={info.keyPlaceholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveSettings();
              e.stopPropagation();
            }}
          />
        </>
      )}
      <button
        type="button"
        title={showSettings ? 'Save agent settings' : `Agent settings (${info.label})`}
        onClick={() => (showSettings ? saveSettings() : setShowSettings(true))}
      >
        <IconKey size={16} stroke={1.75} />
      </button>
    </div>
  );
}
