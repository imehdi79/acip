import { Controller, HttpException, Post, Req } from '@nestjs/common';
import type { IncomingMessage } from 'http';

/**
 * Speech-to-text: raw audio body in (whatever the browser's MediaRecorder
 * produced), Whisper transcript out. Whisper auto-detects the spoken
 * language — that's the point: the old browser SpeechRecognition path was
 * Chrome-only and weak outside English.
 */
@Controller('stt')
export class SttController {
  @Post()
  async transcribe(@Req() req: IncomingMessage): Promise<{ text: string }> {
    const key = process.env.OPENAI_API_KEY;
    if (!key) throw new HttpException('OPENAI_API_KEY is not configured on the server', 503);

    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const audio = Buffer.concat(chunks);
    if (audio.length === 0) throw new HttpException('empty audio body', 400);
    if (audio.length > 24 * 1024 * 1024) {
      throw new HttpException('audio too large (Whisper limit is 25 MB)', 413);
    }

    const type = req.headers['content-type'] ?? 'audio/webm';
    const ext = type.includes('mp4') ? 'mp4' : type.includes('ogg') ? 'ogg' : 'webm';
    const form = new FormData();
    form.append('file', new Blob([new Uint8Array(audio)], { type }), `speech.${ext}`);
    form.append('model', 'whisper-1');

    const response = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${key}` },
      body: form,
    });
    if (!response.ok) throw new HttpException(await response.text(), response.status);
    const data = (await response.json()) as { text?: string };
    return { text: data.text ?? '' };
  }
}
