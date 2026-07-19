import {
  commandNameFromTool,
  describeDocument,
  toolDefinitions,
} from '@acip/editor-core';
import type { EditorSession, JsonObject } from '@acip/editor-core';
import type {
  ImageBlock,
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

/** one prior conversation exchange, replayed as plain text for context */
export interface ChatTurn {
  readonly role: 'user' | 'assistant';
  readonly text: string;
}

export interface DrafterRunOptions {
  maxTurns?: number;
  /** fires after every dispatch (success or failure) — live progress for UIs */
  onDispatch?: (entry: DispatchLogEntry) => void;
  /** replaces the drafting system prompt (e.g. ESTIMATOR_SYSTEM_PROMPT) */
  system?: string;
  /**
   * Prior exchanges for multi-message conversations (the estimator's
   * propose → confirm flow). Text only — the fresh document digest attached
   * to the current prompt is the ground truth, not old tool traffic.
   */
  history?: readonly ChatTurn[];
  /** attached to the current prompt (plan crops for tracing), images first */
  images?: readonly ImageBlock[];
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
- Every entity carries a per-type "mark" number — the name users know it by.
  "wall 3" means the entity with type "wall" and mark 3 in the digest; resolve
  the mark to its id for tool calls. When you talk about entities, cite marks
  ("wall 3", "door 1"), never raw ids. Detected spaces list wallMarks so you
  can say "the 14 m² room is bounded by walls 2, 3, 5, 6".
- If the user asks for an element, operation, or price the tools cannot
  express, call REQUEST_LOG once with a short description of the gap, tell
  the user it was recorded, and continue with what you CAN do.
- When the task is complete, reply with a one-paragraph summary and no more
  tool calls.`;

/**
 * Estimation mode: same loop, same tools, opposite confirmation policy —
 * the drafter draws speculatively, the estimator NEVER mutates before the
 * user confirms a step. Guides assembly build-up assignment group by group.
 */
export const ESTIMATOR_SYSTEM_PROMPT = `You are an estimation agent for a cost-aware building modeler (CAD).
You help the user assign assembly build-ups to elements and produce a priced
bill of quantities. You act ONLY by calling tools; each tool is a validated
document command.

Rules of the model:
- Entities carry a per-type "mark" number — "wall 3" is the entity with type
  "wall" and mark 3 in the digest. Resolve marks to ids for tool calls; always
  speak in marks, never raw ids. Detected spaces list wallMarks per room.
- Types are assembly build-ups (ordered layers: material + thickness)
  targeting walls, slabs, or roofs. A material's unit (m3, m2, m, or count
  with coverage) drives how its layer is measured; its costCode keys the rate
  table. Assign a type with ENTITY_SETTYPE.
- The app shows a live bill of quantities that reprices on every change —
  keep numeric summaries brief.

Rules of the conversation:
- THE USER DECIDES. Never call a mutating tool before the user explicitly
  confirms that step. Propose in plain text first: the build-up (layers,
  thicknesses, units) and exactly which marks it applies to.
- Work in groups, never element by element: use spaces/wallMarks to separate
  exterior walls from interior partitions; slabs and roofs are their own
  groups. Offer choices like "apply to walls 2, 5, 7" or "all exterior walls".
- Two working styles — follow the user's lead:
  smart: propose a complete plan (one build-up per group) in one message,
  then apply group by group as the user approves;
  manual: ask group by group what the user wants, listing existing catalog
  types first so nothing gets duplicated.
- Apply ONE confirmed step per reply (create or reuse materials and types,
  then ENTITY_SETTYPE the group) so every step stays individually undoable.
- Reuse existing materials and types from the digest whenever they fit.
- If a needed price is missing, call REQUEST_LOG once per gap with a short
  description so the office can price it, tell the user, and continue.`;

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

  async run(
    prompt: string,
    options: DrafterRunOptions = {},
  ): Promise<DrafterRunResult> {
    const maxTurns = options.maxTurns ?? 8;
    const tools = toolDefinitions(this.session.commands);
    const digest = describeDocument(this.session.doc);
    const messages: LlmMessage[] = [
      ...(options.history ?? []).map(
        (turn): LlmMessage => ({
          role: turn.role,
          content: [{ type: 'text', text: turn.text }],
        }),
      ),
      {
        role: 'user',
        content: [
          ...(options.images ?? []),
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
        const reply = await this.llm.complete({
          system: options.system ?? SYSTEM_PROMPT,
          messages,
          tools,
        });
        messages.push({ role: 'assistant', content: reply.content });

        const texts = reply.content.filter(
          (b): b is TextBlock => b.type === 'text',
        );
        if (texts.length > 0) summary = texts.map((t) => t.text).join('\n');

        const toolUses = reply.content.filter(
          (b): b is ToolUseBlock => b.type === 'tool_use',
        );
        if (toolUses.length === 0) {
          return {
            summary,
            dispatched,
            turns: turn,
            stopped: 'completed' as const,
          };
        }

        const results: ToolResultBlock[] = toolUses.map((use) =>
          this.execute(use, dispatched, options.onDispatch),
        );
        messages.push({ role: 'user', content: results });
      }
      return {
        summary,
        dispatched,
        turns: maxTurns,
        stopped: 'max-turns' as const,
      };
    });
  }

  private execute(
    use: ToolUseBlock,
    log: DispatchLogEntry[],
    onDispatch?: (entry: DispatchLogEntry) => void,
  ): ToolResultBlock {
    const command = commandNameFromTool(use.name);
    let entry: DispatchLogEntry;
    let result: ToolResultBlock;
    try {
      const value = this.session.dispatch(command, use.input);
      entry = { command, params: use.input, ok: true, result: value };
      result = {
        type: 'tool_result',
        tool_use_id: use.id,
        content: JSON.stringify({ result: value ?? null }),
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      entry = { command, params: use.input, ok: false, error: message };
      result = {
        type: 'tool_result',
        tool_use_id: use.id,
        content: message,
        is_error: true,
      };
    }
    log.push(entry);
    onDispatch?.(entry);
    return result;
  }
}
