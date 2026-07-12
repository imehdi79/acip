import type { LlmClient, LlmRequest, LlmTurn } from './llm-client.js';

export interface AnthropicClientOptions {
  apiKey: string;
  /** defaults to claude-fable-5 */
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  /**
   * Required for direct calls from a browser (CORS is refused without it).
   * Only sensible when the key belongs to the person at the keyboard —
   * a shared deployment should proxy through a server instead.
   */
  dangerouslyAllowBrowser?: boolean;
  /** injectable for tests and non-standard runtimes */
  fetchFn?: typeof fetch;
}

/**
 * Minimal fetch-based Anthropic Messages client — no SDK dependency, so the
 * agent stays as headless as the core (browser, Web Worker, node, bun).
 */
export class AnthropicClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly baseUrl: string;
  private readonly allowBrowser: boolean;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnthropicClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'claude-fable-5';
    this.maxTokens = options.maxTokens ?? 4096;
    this.baseUrl = options.baseUrl ?? 'https://api.anthropic.com';
    this.allowBrowser = options.dangerouslyAllowBrowser ?? false;
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    const headers: Record<string, string> = {
      'x-api-key': this.apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    };
    if (this.allowBrowser) {
      headers['anthropic-dangerous-direct-browser-access'] = 'true';
    }
    const response = await this.fetchFn(`${this.baseUrl}/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: this.model,
        max_tokens: this.maxTokens,
        system: request.system,
        messages: request.messages,
        tools: request.tools,
      }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`Anthropic API ${response.status}: ${detail}`);
    }
    const data = (await response.json()) as {
      content: LlmTurn['content'];
      stop_reason: string;
    };
    return { content: data.content, stopReason: data.stop_reason };
  }
}
