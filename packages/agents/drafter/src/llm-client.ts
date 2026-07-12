import type { JsonObject, ToolDefinition } from '@acip/editor-core';

/**
 * Provider-agnostic LLM protocol in the Anthropic Messages shape (the
 * reference wire format; other providers adapt behind this interface).
 * The agent depends only on LlmClient — tests inject a scripted fake.
 */

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: JsonObject;
}

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: string;
  readonly is_error?: boolean;
}

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock;

export interface LlmMessage {
  readonly role: 'user' | 'assistant';
  readonly content: readonly ContentBlock[];
}

export interface LlmRequest {
  readonly system: string;
  readonly messages: readonly LlmMessage[];
  readonly tools: readonly ToolDefinition[];
}

export interface LlmTurn {
  readonly content: readonly (TextBlock | ToolUseBlock)[];
  readonly stopReason: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmTurn>;
}
