import { Body, Controller, HttpException, Post } from '@nestjs/common';

/**
 * Key-holding proxy for the drafter's LlmClients. The routes mirror the
 * provider paths exactly, so the browser clients just point their baseUrl at
 * /api/llm/<provider> and send no key — the server injects it from .env.
 */
@Controller('llm')
export class LlmController {
  @Post('anthropic/v1/messages')
  async anthropic(@Body() body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': requiredEnv('ANTHROPIC_API_KEY'),
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    });
    return relay(response);
  }

  @Post('openai/v1/chat/completions')
  async openai(@Body() body: Record<string, unknown>): Promise<unknown> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${requiredEnv('OPENAI_API_KEY')}`,
      },
      body: JSON.stringify(body),
    });
    return relay(response);
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new HttpException(`${name} is not configured on the server`, 503);
  return value;
}

/** mirror the provider's status + body so client error paths behave identically */
async function relay(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) throw new HttpException(text, response.status);
  return JSON.parse(text);
}
