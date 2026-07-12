import {
  commandNameFromTool,
  describeDocument,
  toolDefinitions,
} from '@acip/editor-core';
import type { EditorSession, JsonObject } from '@acip/editor-core';
import type {
  LlmClient,
  LlmMessage,
  TextBlock,
  ToolResultBlock,
  ToolUseBlock,
} from './llm-client.js';

export interface DispatchLogEntry {
  readonly command: string;
  readonly params: JsonObject;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: string;
}

export interface DrafterRunResult {
  /** the model's final text reply */
  readonly summary: string;
  readonly dispatched: readonly DispatchLogEntry[];
  readonly turns: number;
  readonly stopped: 'completed' | 'max-turns';
}

export interface DrafterRunOptions {
  maxTurns?: number;
}

const SYSTEM_PROMPT = `You are a drafting agent for a cost-aware building modeler (CAD).
You act ONLY by calling tools; each tool is a validated document command.

Rules of the model:
- Coordinates are 2D plan meters, +x right, +y up. 3D is derived from the plan.
- Walls are baselines with thickness. Walls sharing an endpoint auto-join
  their corners — draw a room as a closed loop of walls with exactly shared
  endpoint coordinates.
- Windows and doors are hosted in walls parametrically: t runs 0..1 along the
  wall baseline. They follow the wall when it moves.
- Prefer WALL_ADD for building elements; LINE_ADD is bare drafting geometry.
- If a tool call fails you get the validation message back — correct the
  parameters and retry.
- The user's message includes a JSON digest of the current document (ids,
  levels, materials, quantities). Use those ids; never invent ids.
- When the task is complete, reply with a one-paragraph summary and no more
  tool calls.`;

/**
 * The first agent: natural language -> commands. Observes nothing it isn't
 * given, reads through the document digest, acts only via the command bus,
 * and the whole run is one history group — a single Ctrl+Z for the user.
 */
export class DrafterAgent {
  constructor(
    private readonly session: EditorSession,
    private readonly llm: LlmClient,
  ) {}

  async run(prompt: string, options: DrafterRunOptions = {}): Promise<DrafterRunResult> {
    const maxTurns = options.maxTurns ?? 8;
    const tools = toolDefinitions(this.session.commands);
    const digest = describeDocument(this.session.doc);
    const messages: LlmMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${prompt}\n\nCurrent document digest:\n${JSON.stringify(digest)}`,
          },
        ],
      },
    ];
    const dispatched: DispatchLogEntry[] = [];
    let summary = '';

    return this.session.history.runGrouped(async () => {
      for (let turn = 1; turn <= maxTurns; turn++) {
        const reply = await this.llm.complete({ system: SYSTEM_PROMPT, messages, tools });
        messages.push({ role: 'assistant', content: reply.content });

        const texts = reply.content.filter((b): b is TextBlock => b.type === 'text');
        if (texts.length > 0) summary = texts.map((t) => t.text).join('\n');

        const toolUses = reply.content.filter((b): b is ToolUseBlock => b.type === 'tool_use');
        if (toolUses.length === 0) {
          return { summary, dispatched, turns: turn, stopped: 'completed' as const };
        }

        const results: ToolResultBlock[] = toolUses.map((use) => this.execute(use, dispatched));
        messages.push({ role: 'user', content: results });
      }
      return { summary, dispatched, turns: maxTurns, stopped: 'max-turns' as const };
    });
  }

  private execute(use: ToolUseBlock, log: DispatchLogEntry[]): ToolResultBlock {
    const command = commandNameFromTool(use.name);
    try {
      const result = this.session.dispatch(command, use.input);
      log.push({ command, params: use.input, ok: true, result });
      return {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify({ result: result ?? null }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.push({ command, params: use.input, ok: false, error: message });
      return { type: 'tool_result', tool_use_id: use.id, content: message, is_error: true };
    }
  }
}
