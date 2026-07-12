import { AnthropicClient, DrafterAgent } from '@acip/agent-drafter';
import type { EditorSession } from '@acip/editor-core';
import type { EditorUi } from './ui-state';

const KEY_STORAGE = 'acip.anthropic-api-key';

export function getApiKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? '';
}

export function setApiKey(key: string): void {
  const trimmed = key.trim();
  if (trimmed) localStorage.setItem(KEY_STORAGE, trimmed);
  else localStorage.removeItem(KEY_STORAGE);
}

/**
 * Run the drafter against the live session. The key stays in this browser
 * (localStorage + direct API call with the browser opt-in header); a shared
 * deployment would proxy through editor-server instead. The whole run lands
 * as a single undo step via history grouping.
 */
export async function runDrafter(
  session: EditorSession,
  ui: EditorUi,
  prompt: string,
): Promise<void> {
  if (ui.agentBusy.get()) return;
  const apiKey = getApiKey();
  if (!apiKey) {
    ui.appendLog('No API key set — use the key button to paste your Anthropic key.', 'error');
    return;
  }
  ui.agentBusy.set(true);
  ui.appendLog(`ai> ${prompt}`, 'echo');
  try {
    const llm = new AnthropicClient({ apiKey, dangerouslyAllowBrowser: true });
    const agent = new DrafterAgent(session, llm);
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
