/**
 * editor-server: the key-holding backend for shared deployments.
 * - /api/llm/*      LLM proxy (keys from .env, never in the browser)
 * - /api/stt        Whisper speech-to-text (any language)
 * - /api/requests   the wishlist — what users wanted that we don't have yet
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app/app.module';

/** minimal .env loader — no dependency; real environment variables win */
function loadDotEnv(): void {
  const candidates = [
    join(__dirname, '..', '.env'), // apps/editor-server/.env, next to dist/
    join(process.cwd(), 'apps', 'editor-server', '.env'),
    join(process.cwd(), '.env'),
  ];
  const file = candidates.find((p) => existsSync(p));
  if (!file) return;
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (line.trimStart().startsWith('#')) continue;
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    const value = match[2].replace(/^["']|["']$/g, '');
    if (process.env[match[1]] === undefined) process.env[match[1]] = value;
  }
}

async function bootstrap() {
  loadDotEnv();
  // bodyParser off, then explicit: agent turns carry the whole document
  // digest (default 100 kb is too small), and /api/stt needs the raw stream
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true });
  const globalPrefix = 'api';
  app.setGlobalPrefix(globalPrefix);
  const origins = (process.env.CORS_ORIGIN ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({ origin: origins.length > 0 ? origins : true });
  const port = process.env.PORT || 3000;
  await app.listen(port);
  Logger.log(
    `🚀 Application is running on: http://localhost:${port}/${globalPrefix}`,
  );
}

bootstrap();
