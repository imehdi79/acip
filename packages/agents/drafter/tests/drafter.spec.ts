import { describe, expect, test } from 'bun:test';
import { EditorSession } from '@acip/editor-core';
import type { JsonObject } from '@acip/editor-core';
import { DrafterAgent } from '../src/index.js';
import type { LlmClient, LlmRequest, LlmTurn, ToolResultBlock } from '../src/index.js';

/** scripted fake: returns canned turns, records every request it saw */
class FakeLlm implements LlmClient {
  readonly requests: LlmRequest[] = [];
  private turn = 0;

  constructor(private readonly turns: LlmTurn[]) {}

  complete(request: LlmRequest): Promise<LlmTurn> {
    // snapshot: the agent mutates its messages array between calls
    this.requests.push({ ...request, messages: [...request.messages] });
    const reply = this.turns[Math.min(this.turn, this.turns.length - 1)];
    this.turn += 1;
    return Promise.resolve(reply);
  }
}

function wallCall(id: string, ax: number, ay: number, bx: number, by: number): JsonObject {
  return {
    type: 'tool_use',
    id,
    name: 'WALL_ADD',
    input: { a: { x: ax, y: ay }, b: { x: bx, y: by } },
  };
}

describe('DrafterAgent — NL to commands through the bus', () => {
  test('draws a room from scripted tool calls; whole run is one undo', async () => {
    const session = new EditorSession();
    const llm = new FakeLlm([
      {
        content: [
          wallCall('t1', 0, 0, 6, 0),
          wallCall('t2', 6, 0, 6, 4),
          wallCall('t3', 6, 4, 0, 4),
          wallCall('t4', 0, 4, 0, 0),
        ] as LlmTurn['content'],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'Drew a 6x4 room of four joined walls.' }],
        stopReason: 'end_turn',
      },
    ]);

    const agent = new DrafterAgent(session, llm);
    const live: string[] = [];
    const result = await agent.run('draw a 6 by 4 meter room', {
      onDispatch: (entry) => live.push(entry.command),
    });

    expect(result.stopped).toBe('completed');
    expect(result.turns).toBe(2);
    expect(result.summary).toContain('6x4 room');
    expect(result.dispatched).toHaveLength(4);
    expect(result.dispatched.every((d) => d.ok)).toBe(true);
    expect(live).toEqual(['WALL.ADD', 'WALL.ADD', 'WALL.ADD', 'WALL.ADD']);
    expect(session.doc.count).toBe(4);

    // the whole agent run undoes with a single Ctrl+Z
    session.undo();
    expect(session.doc.count).toBe(0);

    // first request carried the tool catalog and the document digest
    const first = llm.requests[0];
    expect(first.tools.some((t) => t.name === 'WALL_ADD')).toBe(true);
    const firstText = first.messages[0].content[0];
    expect(firstText.type).toBe('text');
    expect((firstText as { text: string }).text).toContain('Current document digest');
  });

  test('validation errors feed back as is_error tool results; agent can correct', async () => {
    const session = new EditorSession();
    const llm = new FakeLlm([
      {
        // missing b — the bus rejects it
        content: [
          { type: 'tool_use', id: 'bad', name: 'WALL_ADD', input: { a: { x: 0, y: 0 } } },
        ] as LlmTurn['content'],
        stopReason: 'tool_use',
      },
      {
        content: [wallCall('fixed', 0, 0, 5, 0)] as LlmTurn['content'],
        stopReason: 'tool_use',
      },
      {
        content: [{ type: 'text', text: 'Corrected and placed the wall.' }],
        stopReason: 'end_turn',
      },
    ]);

    const agent = new DrafterAgent(session, llm);
    const result = await agent.run('add a 5m wall');

    expect(result.dispatched).toHaveLength(2);
    expect(result.dispatched[0].ok).toBe(false);
    expect(result.dispatched[0].error).toBeTruthy();
    expect(result.dispatched[1].ok).toBe(true);
    expect(session.doc.count).toBe(1);

    // the error went back to the model as an is_error tool result
    const secondRequest = llm.requests[1];
    const lastMessage = secondRequest.messages[secondRequest.messages.length - 1];
    const errorResult = lastMessage.content[0] as ToolResultBlock;
    expect(errorResult.type).toBe('tool_result');
    expect(errorResult.is_error).toBe(true);
    expect(errorResult.tool_use_id).toBe('bad');
  });

  test('stops at maxTurns when the model never finishes', async () => {
    const session = new EditorSession();
    const llm = new FakeLlm([
      { content: [wallCall('loop', 0, 0, 1, 0)] as LlmTurn['content'], stopReason: 'tool_use' },
    ]);

    const agent = new DrafterAgent(session, llm);
    const result = await agent.run('draw forever', { maxTurns: 3 });

    expect(result.stopped).toBe('max-turns');
    expect(result.turns).toBe(3);
    expect(result.dispatched).toHaveLength(3);
    // still a single undo entry despite hitting the cap
    session.undo();
    expect(session.doc.count).toBe(0);
  });
});
