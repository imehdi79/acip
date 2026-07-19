import {
  AnthropicClient,
  DrafterAgent,
  ESTIMATOR_SYSTEM_PROMPT,
  OpenAiClient,
} from '@acip/agent-drafter';
import type { ChatTurn, LlmClient } from '@acip/agent-drafter';
import type { EditorSession } from '@acip/editor-core';
import type { EditorUi } from './ui-state';

export type AgentProvider = 'anthropic' | 'openai';

export interface ModelOption {
  readonly id: string;
  readonly label: string;
}

export interface ProviderInfo {
  readonly id: AgentProvider;
  readonly label: string;
  /** selectable models; the first is the default */
  readonly models: readonly ModelOption[];
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    models: [
      { id: 'claude-fable-5', label: 'Fable 5' },
      { id: 'claude-opus-4-8', label: 'Opus 4.8' },
      { id: 'claude-sonnet-4-6', label: 'Sonnet 4.6' },
      { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI (Codex)',
    models: [
      { id: 'gpt-5-codex', label: 'GPT-5 Codex' },
      { id: 'gpt-5', label: 'GPT-5' },
      { id: 'gpt-5-mini', label: 'GPT-5 mini' },
      { id: 'gpt-4o', label: 'GPT-4o' },
      { id: 'gpt-4o-mini', label: 'GPT-4o mini' },
    ],
  },
];

/** the effective model for a provider — the saved choice, or its default */
export function resolvedModel(provider: AgentProvider): string {
  return getModel(provider) || providerInfo(provider).models[0].id;
}

const PROVIDER_STORAGE = 'acip.agent-provider';
const modelStorage = (p: AgentProvider): string => `acip.${p}-model`;

/**
 * editor-server base URL. Keys live in the server's .env — configured once,
 * never in the browser. Empty string = same origin (reverse-proxy setups);
 * dev defaults to the local Nest server.
 */
export function serverUrl(): string {
  const configured =
    (import.meta.env.VITE_EDITOR_SERVER_URL as string | undefined) ||
    'https://acip-api.mehdify.com';
  console.log('serverUrl', configured);
  if (configured) return configured.replace(/\/+$/, '');
  return import.meta.env.DEV ? 'http://localhost:3000' : '';
}

export function providerInfo(id: AgentProvider): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function getProvider(): AgentProvider {
  return localStorage.getItem(PROVIDER_STORAGE) === 'openai'
    ? 'openai'
    : 'anthropic';
}

export function setProvider(provider: AgentProvider): void {
  localStorage.setItem(PROVIDER_STORAGE, provider);
}

/** empty string = the provider default (the client picks it) */
export function getModel(provider: AgentProvider): string {
  return localStorage.getItem(modelStorage(provider)) ?? '';
}

export function setModel(provider: AgentProvider, model: string): void {
  const trimmed = model.trim();
  if (trimmed) localStorage.setItem(modelStorage(provider), trimmed);
  else localStorage.removeItem(modelStorage(provider));
}

/** fire-and-forget persistence of a REQUEST.LOG dispatch into the server DB */
function forwardRequest(params: unknown): void {
  void fetch(`${serverUrl()}/api/requests`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  }).catch(() => undefined);
}

/**
 * Transcribe recorded audio via editor-server → Whisper. Language-agnostic:
 * Whisper auto-detects whatever the user spoke.
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const response = await fetch(`${serverUrl()}/api/stt`, {
    method: 'POST',
    headers: { 'content-type': blob.type || 'audio/webm' },
    body: blob,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(
      `Transcription failed (${response.status}): ${detail.slice(0, 200)}`,
    );
  }
  const data = (await response.json()) as { text?: string };
  return (data.text ?? '').trim();
}

/**
 * Both clients speak through the editor-server proxy: the proxy routes mirror
 * the provider paths, so pointing baseUrl at /api/llm/<provider> is the whole
 * integration. No key leaves the server.
 */
function makeClient(provider: AgentProvider): LlmClient {
  const model = resolvedModel(provider);
  const baseUrl = `${serverUrl()}/api/llm/${provider}`;
  return provider === 'openai'
    ? new OpenAiClient({ apiKey: '', model, baseUrl })
    : new AnthropicClient({ apiKey: '', model, baseUrl });
}

/**
 * Run the drafter against the live session with the selected provider. The
 * key stays in this browser (localStorage + direct API call); a shared
 * deployment would proxy through editor-server instead. DrafterAgent is
 * provider-agnostic — only the LlmClient differs. The whole run lands as a
 * single undo step via history grouping.
 *
 * Progress streams to two surfaces at once: the command log (the bus trace)
 * and the chat panel (the conversation). Returns the model's summary so the
 * chat can speak it for voice-initiated runs.
 */
/**
 * Prior user/agent exchanges as plain text — the estimator's propose → confirm
 * flow needs the model to remember its own proposal. Progress and error rows
 * are UI chrome, not conversation.
 */
function chatHistory(ui: EditorUi): ChatTurn[] {
  return ui.agentChat
    .get()
    .filter((m) => m.role === 'user' || m.role === 'agent')
    .slice(-20)
    .map((m) => ({
      role: m.role === 'user' ? ('user' as const) : ('assistant' as const),
      text: m.text,
    }));
}

export async function runDrafter(
  session: EditorSession,
  ui: EditorUi,
  prompt: string,
): Promise<string | null> {
  if (ui.agentBusy.get()) return null;
  const provider = getProvider();
  const info = providerInfo(provider);
  const mode = ui.agentMode.get();
  const history = chatHistory(ui);
  ui.appendChat(prompt, 'user');
  ui.agentBusy.set(true);
  ui.appendLog(`ai(${info.label}/${mode})> ${prompt}`, 'echo');
  try {
    const agent = new DrafterAgent(session, makeClient(provider));
    const result = await agent.run(prompt, {
      history,
      ...(mode === 'estimator' ? { system: ESTIMATOR_SYSTEM_PROMPT } : {}),
      onDispatch: (entry) => {
        if (entry.ok) {
          ui.appendLog(`  ${entry.command} ok`);
          ui.appendChat(`${entry.command} ✓`, 'progress');
          // the wishlist: a REQUEST.LOG dispatch is the agent saying "the
          // user wanted something we don't have" — persist it server-side
          if (entry.command === 'REQUEST.LOG') forwardRequest(entry.params);
        } else {
          ui.appendLog(`  ${entry.command} failed: ${entry.error}`, 'error');
          ui.appendChat(`${entry.command} ✗ ${entry.error}`, 'error');
        }
      },
    });
    if (result.summary) {
      ui.appendLog(result.summary);
      ui.appendChat(result.summary, 'agent');
    }
    const okCount = result.dispatched.filter((d) => d.ok).length;
    const finish = `${okCount} commands in ${result.turns} turn(s) — one undo step.`;
    ui.appendLog(`Agent finished: ${finish}`);
    ui.appendChat(finish, 'progress');
    if (result.stopped === 'max-turns') {
      const warning =
        'Stopped at the turn limit — say "continue" to pick up where it left off.';
      ui.appendLog(warning, 'error');
      ui.appendChat(warning, 'error');
    }
    return result.summary || null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    ui.appendLog(message, 'error');
    ui.appendChat(message, 'error');
    return null;
  } finally {
    ui.agentBusy.set(false);
  }
}
