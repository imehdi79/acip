import type { JsonObject, ToolDefinition } from '@acip/editor-core';
import type {
  LlmClient,
  LlmMessage,
  LlmRequest,
  LlmTurn,
  TextBlock,
  ToolUseBlock,
} from './llm-client.js';

export interface OpenAiClientOptions {
  apiKey: string;
  /** any OpenAI tool-calling model, e.g. a Codex model; defaults to gpt-4o */
  model?: string;
  maxTokens?: number;
  baseUrl?: string;
  /** injectable for tests and non-standard runtimes */
  fetchFn?: typeof fetch;
}

interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/**
 * Fetch-based OpenAI Chat Completions client (Codex / GPT models). Speaks the
 * same LlmClient protocol as {@link AnthropicClient} by translating the
 * normalized Anthropic-shaped request into OpenAI messages + function tools
 * and mapping the reply back — so DrafterAgent is provider-agnostic and stays
 * SDK-free (browser, Worker, node, bun). OpenAI serves CORS for direct browser
 * calls, so no opt-in header is needed.
 */
export class OpenAiClient implements LlmClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly baseUrl: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: OpenAiClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model ?? 'gpt-4o';
    this.maxTokens = options.maxTokens ?? 4096;
    this.baseUrl = options.baseUrl ?? 'https://api.openai.com';
    // bind to the global: browser fetch throws "Illegal invocation" if called
    // as a method on any object other than the window/worker global
    this.fetchFn = options.fetchFn ?? fetch.bind(globalThis);
  }

  async complete(request: LlmRequest): Promise<LlmTurn> {
    const body: Record<string, unknown> = {
      model: this.model,
      max_completion_tokens: this.maxTokens,
      messages: this.toOpenAiMessages(request),
    };
    if (request.tools.length > 0) {
      body['tools'] = request.tools.map(toOpenAiTool);
      body['tool_choice'] = 'auto';
    }
    const response = await this.fetchFn(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new Error(`OpenAI API ${response.status}: ${detail}`);
    }
    const data = (await response.json()) as {
      choices: { message: OpenAiMessage; finish_reason: string }[];
    };
    const choice = data.choices?.[0];
    return {
      content: fromOpenAiMessage(choice?.message),
      stopReason: mapFinishReason(choice?.finish_reason),
    };
  }

  private toOpenAiMessages(request: LlmRequest): OpenAiMessage[] {
    const out: OpenAiMessage[] = [{ role: 'system', content: request.system }];
    for (const message of request.messages)
      out.push(...translateMessage(message));
    return out;
  }
}

function toOpenAiTool(tool: ToolDefinition): unknown {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  };
}

/** one normalized message becomes one or more OpenAI messages */
function translateMessage(message: LlmMessage): OpenAiMessage[] {
  const out: OpenAiMessage[] = [];
  const texts: string[] = [];
  const toolCalls: OpenAiToolCall[] = [];
  const toolResults: OpenAiMessage[] = [];

  for (const block of message.content) {
    if (block.type === 'text') {
      texts.push(block.text);
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      });
    } else {
      // tool_result — its own OpenAI `tool` message
      toolResults.push({
        role: 'tool',
        tool_call_id: block.tool_use_id,
        content: block.content,
      });
    }
  }

  if (message.role === 'assistant') {
    out.push({
      role: 'assistant',
      content: texts.length > 0 ? texts.join('\n') : null,
      ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
    });
  } else if (texts.length > 0) {
    out.push({ role: 'user', content: texts.join('\n') });
  }
  out.push(...toolResults);
  return out;
}

function fromOpenAiMessage(
  message: OpenAiMessage | undefined,
): (TextBlock | ToolUseBlock)[] {
  if (!message) return [];
  const content: (TextBlock | ToolUseBlock)[] = [];
  if (message.content) content.push({ type: 'text', text: message.content });
  for (const call of message.tool_calls ?? []) {
    let input: JsonObject = {};
    try {
      input = call.function.arguments
        ? (JSON.parse(call.function.arguments) as JsonObject)
        : {};
    } catch {
      // leave input empty — the bus rejects it and the agent self-corrects
    }
    content.push({
      type: 'tool_use',
      id: call.id,
      name: call.function.name,
      input,
    });
  }
  return content;
}

function mapFinishReason(reason: string | undefined): string {
  if (reason === 'tool_calls') return 'tool_use';
  if (reason === 'stop') return 'end_turn';
  return reason ?? 'end_turn';
}
