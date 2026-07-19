import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

const UNITS = new Set(['m3', 'm2', 'm', 'count']);

type ExtractionProvider = 'anthropic' | 'openai';

const DEFAULT_MODEL: Record<ExtractionProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-5',
};

interface IngestBody {
  fileName?: unknown;
  content?: unknown;
  /** 'anthropic' (default) or 'openai' — admin's choice, keys stay in .env */
  provider?: unknown;
  model?: unknown;
}

interface ExtractedRow {
  costCode: string;
  description: string;
  unit: string;
  unitCost: number;
  currency?: string;
  source?: string;
}

/** the shape the editor's estimator consumes (RateTable in @acip/estimator) */
interface RateTablePayload {
  currency: string;
  rates: Record<string, { unit: string; unitCost: number }>;
}

const EXTRACTION_PROMPT = `You extract construction unit rates from a price list.
Return ONLY a JSON array, no prose. One object per priced line item:
{"costCode": string, "description": string, "unit": "m3"|"m2"|"m"|"count",
 "unitCost": number, "currency": string, "source": string}

Rules:
- costCode: a short kebab-case key derived from the item (e.g. "concrete-slab",
  "wall-tile"). Reuse the document's own code column when it has one.
- unit: map the document's unit to m3 (volume), m2 (area), m (length) or
  count (per piece). Skip lines you cannot map or that carry no price.
- unitCost: the numeric price per unit. Never guess a missing number.
- source: quote the original line (trimmed) so a human can verify at a glance.
- Output nothing but the JSON array.`;

/**
 * LLM-assisted price-list ingest. Uploads are extracted into STAGED rows that
 * an admin reviews, edits, and publishes — extraction never goes live on its
 * own, and every row keeps the source line it was read from. The published
 * set is served as a RateTable to replace the editor's demo rates.
 */
@Controller('rates')
export class RatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Post('ingest')
  async ingest(@Body() body: IngestBody) {
    const content = typeof body.content === 'string' ? body.content.trim() : '';
    const fileName =
      typeof body.fileName === 'string' && body.fileName.trim()
        ? body.fileName.trim()
        : 'pasted-text';
    if (!content) throw new HttpException('content is required', 400);
    if (content.length > 200_000)
      throw new HttpException('content too large (200 kB max)', 413);
    const provider: ExtractionProvider =
      body.provider === 'openai' ? 'openai' : 'anthropic';
    // explicit choice wins; the env override keeps its original (Anthropic)
    // meaning so a claude id never gets sent to the OpenAI endpoint
    const model =
      typeof body.model === 'string' && body.model.trim()
        ? body.model.trim()
        : provider === 'anthropic'
          ? process.env.RATES_EXTRACTION_MODEL || DEFAULT_MODEL.anthropic
          : DEFAULT_MODEL.openai;

    const rows = await extractRows(content, provider, model);
    if (rows.length === 0) {
      throw new HttpException(
        'no priced line items could be extracted from that file',
        422,
      );
    }
    const created = await this.prisma.rateRow.createManyAndReturn({
      data: rows.map((row) => ({
        costCode: row.costCode,
        description: row.description,
        unit: row.unit,
        unitCost: row.unitCost,
        currency: row.currency ?? 'EUR',
        sourceFile: fileName,
        sourceHint: row.source ?? null,
      })),
    });
    return { staged: created.length, rows: created };
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.prisma.rateRow.findMany({
      where: status ? { status } : undefined,
      orderBy: [{ status: 'desc' }, { updatedAt: 'desc' }],
      take: 500,
    });
  }

  /** published rows as the estimator's RateTable; later rows win per code */
  @Get('table')
  async table(): Promise<RateTablePayload> {
    const published = await this.prisma.rateRow.findMany({
      where: { status: 'published' },
      orderBy: { updatedAt: 'asc' },
    });
    const rates: RateTablePayload['rates'] = {};
    for (const row of published) {
      rates[row.costCode] = { unit: row.unit, unitCost: row.unitCost };
    }
    return { currency: published[0]?.currency ?? 'EUR', rates };
  }

  @Patch('publish-all')
  async publishAll() {
    const result = await this.prisma.rateRow.updateMany({
      where: { status: 'staged' },
      data: { status: 'published' },
    });
    return { published: result.count };
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    const data: Record<string, unknown> = {};
    if (typeof body.costCode === 'string' && body.costCode.trim())
      data.costCode = body.costCode.trim();
    if (typeof body.description === 'string')
      data.description = body.description.trim();
    if (typeof body.unit === 'string') {
      if (!UNITS.has(body.unit))
        throw new HttpException('unit must be m3, m2, m or count', 400);
      data.unit = body.unit;
    }
    if (body.unitCost !== undefined) {
      const cost = Number(body.unitCost);
      if (!Number.isFinite(cost) || cost < 0)
        throw new HttpException('unitCost must be a non-negative number', 400);
      data.unitCost = cost;
    }
    if (typeof body.currency === 'string' && body.currency.trim())
      data.currency = body.currency.trim().toUpperCase();
    if (body.status !== undefined) {
      if (body.status !== 'staged' && body.status !== 'published')
        throw new HttpException("status must be 'staged' or 'published'", 400);
      data.status = body.status;
    }
    if (Object.keys(data).length === 0)
      throw new HttpException('nothing to update', 400);
    return this.prisma.rateRow.update({ where: { id: Number(id) }, data });
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.prisma.rateRow.delete({ where: { id: Number(id) } });
  }
}

/**
 * One provider call, JSON-array-only output, forgiving parse + strict
 * validation. Same admin choice the drafter offers: Anthropic or OpenAI,
 * keys from .env either way.
 */
async function extractRows(
  content: string,
  provider: ExtractionProvider,
  model: string,
): Promise<ExtractedRow[]> {
  const raw =
    provider === 'openai'
      ? await completeOpenAi(content, model)
      : await completeAnthropic(content, model);
  return parseRows(raw);
}

async function completeAnthropic(
  content: string,
  model: string,
): Promise<string> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey)
    throw new HttpException('ANTHROPIC_API_KEY is not configured', 503);

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 8192,
      system: EXTRACTION_PROMPT,
      messages: [{ role: 'user', content }],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpException(text, response.status);

  const reply = JSON.parse(text) as {
    content?: { type: string; text?: string }[];
  };
  return (reply.content ?? [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? '')
    .join('\n');
}

async function completeOpenAi(content: string, model: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new HttpException('OPENAI_API_KEY is not configured', 503);

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      max_completion_tokens: 8192,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content },
      ],
    }),
  });
  const text = await response.text();
  if (!response.ok) throw new HttpException(text, response.status);

  const reply = JSON.parse(text) as {
    choices?: { message?: { content?: string | null } }[];
  };
  return reply.choices?.[0]?.message?.content ?? '';
}

function parseRows(raw: string): ExtractedRow[] {
  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start < 0 || end <= start) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const rows: ExtractedRow[] = [];
  for (const item of parsed) {
    if (typeof item !== 'object' || item === null) continue;
    const r = item as Record<string, unknown>;
    const costCode =
      typeof r.costCode === 'string'
        ? r.costCode.trim().toLowerCase().replace(/\s+/g, '-')
        : '';
    const description =
      typeof r.description === 'string' ? r.description.trim() : '';
    const unit = typeof r.unit === 'string' ? r.unit : '';
    const unitCost = Number(r.unitCost);
    if (!costCode || !description) continue;
    if (!UNITS.has(unit)) continue;
    if (!Number.isFinite(unitCost) || unitCost < 0) continue;
    rows.push({
      costCode,
      description,
      unit,
      unitCost,
      currency:
        typeof r.currency === 'string' && r.currency.trim()
          ? r.currency.trim().toUpperCase()
          : undefined,
      source: typeof r.source === 'string' ? r.source.slice(0, 300) : undefined,
    });
  }
  return rows;
}
