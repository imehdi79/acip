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
  getApiKey,
  getProvider,
  providerInfo,
  resolvedModel,
  runDrafter,
  setApiKey,
  setModel,
  setProvider,
} from '../agent';

// ── speech (zero-cost voice: browser Web Speech API, no backend, no key) ──
// TypeScript's dom lib has no SpeechRecognition types; declare the sliver we use.
interface SpeechResultEvent {
  readonly resultIndex: number;
  readonly results: ArrayLike<{ readonly isFinal: boolean } & ArrayLike<{ transcript: string }>>;
}
interface SpeechRecognitionLike {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  onresult: ((e: SpeechResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  start(): void;
  stop(): void;
}

function speechRecognitionCtor(): (new () => SpeechRecognitionLike) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => SpeechRecognitionLike;
    webkitSpeechRecognition?: new () => SpeechRecognitionLike;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** speak an agent reply aloud — free, built-in, cancellable by the next one */
function speak(text: string): void {
  if (!('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
}

/**
 * Dictation hook: interim transcripts preview into the input, the final
 * transcript is handed to onFinal (the chat auto-sends it and speaks the
 * reply — talk in, hear out). Unsupported browsers simply get no mic button.
 */
function useSpeechInput(handlers: {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
}): { supported: boolean; listening: boolean; toggle: () => void } {
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const supported = speechRecognitionCtor() !== null;

  const toggle = () => {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }
    const Ctor = speechRecognitionCtor();
    if (!Ctor) return;
    const recognition = new Ctor();
    recognition.lang = navigator.language || 'en-US';
    recognition.interimResults = true;
    recognition.continuous = false;
    let finalText = '';
    recognition.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (result.isFinal) finalText += result[0].transcript;
        else interim += result[0].transcript;
      }
      handlersRef.current.onInterim(finalText + interim);
    };
    recognition.onend = () => {
      setListening(false);
      recognitionRef.current = null;
      const text = finalText.trim();
      if (text) handlersRef.current.onFinal(text);
    };
    recognition.onerror = () => {
      // onend fires after onerror; nothing to send, the input keeps the interim
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  };

  useEffect(() => () => recognitionRef.current?.stop(), []);

  return { supported, listening, toggle };
}

/**
 * The drafter as a chat: a floating bubble over the viewport that opens into
 * a conversation. Same command bus underneath — bubbles are just the
 * natural-language face of session.dispatch, exactly like the old agent row.
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
  const [key, setKey] = useState(() => getApiKey(getProvider()));
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

  const { supported, listening, toggle } = useSpeechInput({
    onInterim: setInput,
    onFinal: (text) => send(text, true),
  });

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
    ui.appendChat(
      key.trim() ? `${info.label} key saved (this browser only), model ${model}.` : `${info.label} key cleared.`,
      'progress',
    );
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
          title="Provider, model & key"
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
          <input
            type="password"
            placeholder={info.keyPlaceholder}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveSettings();
              e.stopPropagation();
            }}
          />
          <button type="button" onClick={saveSettings}>
            Save
          </button>
        </div>
      )}
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="chat-empty">
            Ask for a drawing — “a 6 by 4 m room with a door and two windows”.
            {supported ? ' Or tap the mic and just say it.' : ''}
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
        {supported && (
          <button
            type="button"
            className={listening ? 'chat-mic listening' : 'chat-mic'}
            title={listening ? 'Stop listening (sends what was heard)' : 'Speak your prompt'}
            onClick={toggle}
          >
            <IconMicrophone size={16} stroke={1.75} />
          </button>
        )}
        <input
          value={input}
          disabled={busy}
          placeholder={
            listening ? 'Listening…' : busy ? 'Agent is drawing…' : `Ask ${info.label}…`
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
