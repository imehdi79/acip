import { AnthropicClient, DrafterAgent, OpenAiClient } from '@acip/agent-drafter';
import type { LlmClient } from '@acip/agent-drafter';
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
  readonly keyPlaceholder: string;
  /** selectable models; the first is the default */
  readonly models: readonly ModelOption[];
}

export const PROVIDERS: readonly ProviderInfo[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyPlaceholder: 'sk-ant-…',
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
    keyPlaceholder: 'sk-…',
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
const keyStorage = (p: AgentProvider): string => `acip.${p}-api-key`;
const modelStorage = (p: AgentProvider): string => `acip.${p}-model`;

export function providerInfo(id: AgentProvider): ProviderInfo {
  return PROVIDERS.find((p) => p.id === id) ?? PROVIDERS[0];
}

export function getProvider(): AgentProvider {
  return localStorage.getItem(PROVIDER_STORAGE) === 'openai' ? 'openai' : 'anthropic';
}

export function setProvider(provider: AgentProvider): void {
  localStorage.setItem(PROVIDER_STORAGE, provider);
}

export function getApiKey(provider: AgentProvider): string {
  return localStorage.getItem(keyStorage(provider)) ?? '';
}

export function setApiKey(provider: AgentProvider, key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(keyStorage(provider), trimmed);
  else localStorage.removeItem(keyStorage(provider));
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

function makeClient(provider: AgentProvider, apiKey: string): LlmClient {
  const model = resolvedModel(provider);
  return provider === 'openai'
    ? new OpenAiClient({ apiKey, model })
    : new AnthropicClient({ apiKey, model, dangerouslyAllowBrowser: true });
}

/**
 * Run the drafter against the live session with the selected provider. The
 * key stays in this browser (localStorage + direct API call); a shared
 * deployment would proxy through editor-server instead. DrafterAgent is
 * provider-agnostic — only the LlmClient differs. The whole run lands as a
 * single undo step via history grouping.
 */
export async function runDrafter(
  session: EditorSession,
  ui: EditorUi,
  prompt: string,
): Promise<void> {
  if (ui.agentBusy.get()) return;
  const provider = getProvider();
  const info = providerInfo(provider);
  const apiKey = getApiKey(provider);
  if (!apiKey) {
    ui.appendLog(`No ${info.label} key set — use the key button to paste it.`, 'error');
    return;
  }
  ui.agentBusy.set(true);
  ui.appendLog(`ai(${info.label})> ${prompt}`, 'echo');
  try {
    const agent = new DrafterAgent(session, makeClient(provider, apiKey));
    const result = await agent.run(prompt, {
      onDispatch: (entry) =>
        entry.ok
          ? ui.appendLog(`  ${entry.command} ok`)
          : ui.appendLog(`  ${entry.command} failed: ${entry.error}`, 'error'),
    });
    if (result.summary) ui.appendLog(result.summary);
    const okCount = result.dispatched.filter((d) => d.ok).length;
    ui.appendLog(`Agent finished: ${okCount} commands in ${result.turns} turn(s) — one undo step.`);
    if (result.stopped === 'max-turns') {
      ui.appendLog('Stopped at the turn limit before the agent declared itself done.', 'error');
    }
  } catch (err) {
    ui.appendLog(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    ui.agentBusy.set(false);
  }
}
