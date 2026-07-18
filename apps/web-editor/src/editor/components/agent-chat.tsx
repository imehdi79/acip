import { useEffect, useRef, useState } from 'react';
import {
  IconMicrophone,
  IconSend2,
  IconSettings,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { useSession } from '../session-context';
import { useRuntime } from '../runtime';
import { useStoreValue } from '../store';
import type { AgentProvider } from '../agent';
import {
  PROVIDERS,
  getProvider,
  providerInfo,
  resolvedModel,
  runDrafter,
  setModel,
  setProvider,
  transcribeAudio,
} from '../agent';

/** speak an agent reply aloud — free, built-in, cancellable by the next one */
function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

type VoiceState = 'idle' | 'recording' | 'transcribing';

/**
 * Push-to-talk in any language: MediaRecorder captures audio, editor-server's
 * /api/stt (Whisper) transcribes it — the language is auto-detected, no
 * browser speech engine involved. Click to record, click again to send.
 */
function useVoiceInput(handlers: {
  onFinal: (text: string) => void;
  onError: (message: string) => void;
}): { supported: boolean; state: VoiceState; toggle: () => void } {
  const [state, setState] = useState<VoiceState>('idle');
  const recorderRef = useRef<MediaRecorder | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const supported =
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined';

  const toggle = () => {
    if (state === 'transcribing') return;
    if (state === 'recording') {
      recorderRef.current?.stop();
      return;
    }
    void navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        const recorder = new MediaRecorder(stream);
        const chunks: Blob[] = [];
        recorder.ondataavailable = (e) => {
          if (e.data.size > 0) chunks.push(e.data);
        };
        recorder.onstop = () => {
          for (const track of stream.getTracks()) track.stop();
          recorderRef.current = null;
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
          if (blob.size === 0) {
            setState('idle');
            return;
          }
          setState('transcribing');
          transcribeAudio(blob)
            .then((text) => {
              setState('idle');
              if (text) handlersRef.current.onFinal(text);
            })
            .catch((err) => {
              setState('idle');
              handlersRef.current.onError(err instanceof Error ? err.message : String(err));
            });
        };
        recorderRef.current = recorder;
        setState('recording');
        recorder.start();
      })
      .catch(() => handlersRef.current.onError('Microphone access was denied.'));
  };

  useEffect(
    () => () => {
      recorderRef.current?.stop();
    },
    [],
  );

  return { supported, state, toggle };
}

/**
 * The drafter as a chat: a floating bubble over the viewport that opens into
 * a conversation. Same command bus underneath — bubbles are just the
 * natural-language face of session.dispatch. All provider traffic goes
 * through editor-server; there is no key to paste in the browser anymore.
 */
export function AgentChat() {
  const session = useSession();
  const { ui } = useRuntime();
  const open = useStoreValue(ui.agentChatOpen);
  const busy = useStoreValue(ui.agentBusy);
  const messages = useStoreValue(ui.agentChat);
  const [input, setInput] = useState('');
  const [showSettings, setShowSettings] = useState(false);
  const [provider, setProviderState] = useState<AgentProvider>(getProvider);
  const [model, setModelState] = useState(() => resolvedModel(getProvider()));
  const listRef = useRef<HTMLDivElement>(null);

  const info = providerInfo(provider);

  useEffect(() => {
    listRef.current?.scrollTo(0, listRef.current.scrollHeight);
  }, [messages, busy, open]);

  const send = (text: string, spoken = false) => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setInput('');
    void runDrafter(session, ui, trimmed).then((summary) => {
      // voice in → voice out; typed prompts stay silent
      if (spoken && summary) speak(summary);
    });
  };

  const voice = useVoiceInput({
    onFinal: (text) => send(text, true),
    onError: (message) => ui.appendChat(message, 'error'),
  });

  const switchProvider = (next: AgentProvider) => {
    setProviderState(next);
    setProvider(next);
    setModelState(resolvedModel(next));
  };

  const saveSettings = () => {
    setModel(provider, model);
    setShowSettings(false);
    ui.appendChat(`${info.label} · ${model} selected.`, 'progress');
  };

  if (!open) {
    return (
      <button
        type="button"
        className="chat-bubble"
        title="Drafter chat"
        onClick={() => ui.agentChatOpen.set(true)}
      >
        <IconSparkles size={22} stroke={1.75} className={busy ? 'agent-icon busy' : 'agent-icon'} />
      </button>
    );
  }

  return (
    <div className="chat-panel">
      <header className="chat-header">
        <IconSparkles size={16} stroke={1.75} className={busy ? 'agent-icon busy' : 'agent-icon'} />
        <span className="chat-title">
          Drafter · {info.label} · {info.models.find((m) => m.id === model)?.label ?? model}
        </span>
        <button
          type="button"
          title="Provider & model"
          onClick={() => setShowSettings((v) => !v)}
        >
          <IconSettings size={15} stroke={1.75} />
        </button>
        <button type="button" title="Minimize" onClick={() => ui.agentChatOpen.set(false)}>
          <IconX size={15} stroke={1.75} />
        </button>
      </header>
      {showSettings && (
        <div className="chat-settings">
          <select value={provider} onChange={(e) => switchProvider(e.target.value as AgentProvider)}>
            {PROVIDERS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <select value={model} title="Model" onChange={(e) => setModelState(e.target.value)}>
            {info.models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <button type="button" onClick={saveSettings}>
            Save
          </button>
        </div>
      )}
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-empty">
            Ask for a drawing — “a 6 by 4 m room with a door and two windows”.
            {voice.supported ? ' Or tap the mic and say it in any language.' : ''}
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`chat-msg chat-${m.role}`}>
            {m.text}
          </div>
        ))}
        {busy && <div className="chat-msg chat-progress chat-typing">drawing…</div>}
      </div>
      <div className="chat-input-row">
        {voice.supported && (
          <button
            type="button"
            className={voice.state === 'idle' ? 'chat-mic' : 'chat-mic listening'}
            title={
              voice.state === 'recording'
                ? 'Stop recording (transcribes & sends)'
                : voice.state === 'transcribing'
                  ? 'Transcribing…'
                  : 'Speak your prompt — any language'
            }
            disabled={voice.state === 'transcribing'}
            onClick={voice.toggle}
          >
            <IconMicrophone size={16} stroke={1.75} />
          </button>
        )}
        <input
          value={input}
          disabled={busy}
          placeholder={
            voice.state === 'recording'
              ? 'Recording — click the mic to send…'
              : voice.state === 'transcribing'
                ? 'Transcribing…'
                : busy
                  ? 'Agent is drawing…'
                  : `Ask ${info.label}…`
          }
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') send(input);
            e.stopPropagation();
          }}
        />
        <button
          type="button"
          className="chat-send"
          title="Send"
          disabled={busy || !input.trim()}
          onClick={() => send(input)}
        >
          <IconSend2 size={16} stroke={1.75} />
        </button>
      </div>
    </div>
  );
}
