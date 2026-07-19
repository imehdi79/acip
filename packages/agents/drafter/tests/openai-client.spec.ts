import { describe, expect, test } from 'bun:test';
import { OpenAiClient } from '../src/index.js';
import type { LlmRequest } from '../src/index.js';

interface CapturedCall {
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
}

function fakeFetch(
  captured: CapturedCall[],
  status = 200,
  payload?: unknown,
): typeof fetch {
  return ((url: string | URL | Request, init?: RequestInit) => {
    captured.push({
      url: String(url),
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: JSON.parse(String(init?.body)) as Record<string, unknown>,
    });
    const body = payload ?? {
      choices: [
        {
          message: { role: 'assistant', content: 'ok' },
          finish_reason: 'stop',
        },
      ],
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

describe('OpenAiClient', () => {
  test('posts the Chat Completions shape with a bearer key and default model', async () => {
    const calls: CapturedCall[] = [];
    const client = new OpenAiClient({
      apiKey: 'sk-test',
      fetchFn: fakeFetch(calls),
    });
    const turn = await client.complete({
      system: 'sys',
      messages: [],
      tools: [],
    });

    expect(calls[0].url).toBe('https://api.openai.com/v1/chat/completions');
    expect(calls[0].headers['authorization']).toBe('Bearer sk-test');
    expect(calls[0].body['model']).toBe('gpt-4o');
    // the system prompt becomes a system message; no tools → no tool_choice
    expect(calls[0].body['messages']).toEqual([
      { role: 'system', content: 'sys' },
    ]);
    expect(calls[0].body['tools']).toBeUndefined();
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.content[0]).toEqual({ type: 'text', text: 'ok' });
  });

  test('translates image blocks into multimodal user content (data URLs)', async () => {
    const calls: CapturedCall[] = [];
    const client = new OpenAiClient({
      apiKey: 'sk',
      fetchFn: fakeFetch(calls),
    });
    await client.complete({
      system: 'sys',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: {
                type: 'base64',
                media_type: 'image/png',
                data: 'AAAA',
              },
            },
            { type: 'text', text: 'trace this plan' },
          ],
        },
      ],
      tools: [],
    });

    const messages = calls[0].body['messages'] as {
      role: string;
      content: unknown;
    }[];
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toEqual([
      {
        type: 'image_url',
        image_url: { url: 'data:image/png;base64,AAAA' },
      },
      { type: 'text', text: 'trace this plan' },
    ]);
  });

  test('translates tools and a tool_use/tool_result exchange to OpenAI messages', async () => {
    const calls: CapturedCall[] = [];
    const client = new OpenAiClient({
      apiKey: 'sk',
      model: 'gpt-5-codex',
      fetchFn: fakeFetch(calls),
    });
    const request: LlmRequest = {
      system: 'sys',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'draw a wall' }] },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_use',
              id: 'c1',
              name: 'WALL_ADD',
              input: { a: { x: 0, y: 0 } },
            },
          ],
        },
        {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'c1',
              content: 'need b',
              is_error: true,
            },
          ],
        },
      ],
      tools: [
        {
          name: 'WALL_ADD',
          description: 'add a wall',
          input_schema: { type: 'object' },
        },
      ],
    };
    await client.complete(request);

    const messages = calls[0].body['messages'] as Record<string, unknown>[];
    expect(calls[0].body['model']).toBe('gpt-5-codex');
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(messages[1]).toEqual({ role: 'user', content: 'draw a wall' });
    // assistant tool_use → tool_calls with stringified arguments
    expect(messages[2]).toEqual({
      role: 'assistant',
      content: null,
      tool_calls: [
        {
          id: 'c1',
          type: 'function',
          function: { name: 'WALL_ADD', arguments: '{"a":{"x":0,"y":0}}' },
        },
      ],
    });
    // tool_result → a `tool` message keyed by the call id
    expect(messages[3]).toEqual({
      role: 'tool',
      tool_call_id: 'c1',
      content: 'need b',
    });
    // tool definition → function shape
    const tools = calls[0].body['tools'] as Record<string, unknown>[];
    expect(tools[0]).toEqual({
      type: 'function',
      function: {
        name: 'WALL_ADD',
        description: 'add a wall',
        parameters: { type: 'object' },
      },
    });
    expect(calls[0].body['tool_choice']).toBe('auto');
  });

  test('maps a tool_calls reply back to normalized tool_use blocks', async () => {
    const calls: CapturedCall[] = [];
    const payload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'x1',
                type: 'function',
                function: {
                  name: 'WALL_ADD',
                  arguments: '{"a":{"x":1,"y":2}}',
                },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const client = new OpenAiClient({
      apiKey: 'sk',
      fetchFn: fakeFetch(calls, 200, payload),
    });
    const turn = await client.complete({
      system: 's',
      messages: [],
      tools: [],
    });

    expect(turn.stopReason).toBe('tool_use');
    expect(turn.content).toEqual([
      {
        type: 'tool_use',
        id: 'x1',
        name: 'WALL_ADD',
        input: { a: { x: 1, y: 2 } },
      },
    ]);
  });

  test('malformed tool arguments degrade to empty input, not a throw', async () => {
    const calls: CapturedCall[] = [];
    const payload = {
      choices: [
        {
          message: {
            role: 'assistant',
            content: null,
            tool_calls: [
              {
                id: 'x',
                type: 'function',
                function: { name: 'WALL_ADD', arguments: '{bad' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
    };
    const client = new OpenAiClient({
      apiKey: 'sk',
      fetchFn: fakeFetch(calls, 200, payload),
    });
    const turn = await client.complete({
      system: 's',
      messages: [],
      tools: [],
    });
    expect(turn.content[0]).toEqual({
      type: 'tool_use',
      id: 'x',
      name: 'WALL_ADD',
      input: {},
    });
  });

  test('non-ok responses throw with status and detail', async () => {
    const calls: CapturedCall[] = [];
    const client = new OpenAiClient({
      apiKey: 'bad',
      fetchFn: fakeFetch(calls, 401, { error: 'invalid key' }),
    });
    await expect(
      client.complete({ system: 's', messages: [], tools: [] }),
    ).rejects.toThrow('OpenAI API 401');
  });
});
