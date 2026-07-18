import { describe, expect, test } from 'bun:test';
import { AnthropicClient } from '../src/index.js';

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
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
    };
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      }),
    );
  }) as typeof fetch;
}

const REQUEST = { system: 'sys', messages: [], tools: [] };

describe('AnthropicClient', () => {
  test('sends the Messages API shape with auth headers', async () => {
    const calls: CapturedCall[] = [];
    const client = new AnthropicClient({
      apiKey: 'sk-test',
      fetchFn: fakeFetch(calls),
    });
    const turn = await client.complete(REQUEST);

    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).toBe('sk-test');
    expect(calls[0].headers['anthropic-version']).toBe('2023-06-01');
    expect(
      calls[0].headers['anthropic-dangerous-direct-browser-access'],
    ).toBeUndefined();
    expect(calls[0].body['model']).toBe('claude-fable-5');
    expect(calls[0].body['system']).toBe('sys');
    expect(turn.stopReason).toBe('end_turn');
    expect(turn.content[0]).toEqual({ type: 'text', text: 'ok' });
  });

  test('dangerouslyAllowBrowser adds the CORS opt-in header', async () => {
    const calls: CapturedCall[] = [];
    const client = new AnthropicClient({
      apiKey: 'sk-test',
      dangerouslyAllowBrowser: true,
      fetchFn: fakeFetch(calls),
    });
    await client.complete(REQUEST);
    expect(calls[0].headers['anthropic-dangerous-direct-browser-access']).toBe(
      'true',
    );
  });

  test('non-ok responses throw with status and detail', async () => {
    const calls: CapturedCall[] = [];
    const client = new AnthropicClient({
      apiKey: 'bad',
      fetchFn: fakeFetch(calls, 401, { error: 'invalid api key' }),
    });
    await expect(client.complete(REQUEST)).rejects.toThrow('Anthropic API 401');
  });
});
