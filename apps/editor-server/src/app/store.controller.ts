import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Put,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * The keys the editor is allowed to park here.
 *
 * An allow-list rather than anything goes: this is a key-value table reachable
 * by PUT, and without it the first typo in a client becomes a permanent row
 * nobody can account for. Adding a store is a line here, which is the right
 * amount of friction.
 */
const KEYS = new Set(['manual-rates', 'layer-defaults', 'editor-settings']);

/**
 * The editor's small stores: hand-typed rates, layer defaults, settings.
 *
 * One row per store, the whole blob replaced on write. They are small, they
 * are written by one screen at a time, and the editor already treats each as a
 * single value it reads and sets — merging them field by field here would be
 * inventing a conflict model for data that has never had one.
 *
 * `null` for a key nobody has written yet rather than a 404: "nothing saved"
 * is a normal answer on a fresh deployment, and a client that has to tell an
 * empty store from a broken request on a status code will eventually get it
 * wrong.
 */
@Controller('store')
export class StoreController {
  constructor(private readonly prisma: PrismaService) {}

  @Get(':key')
  async read(@Param('key') key: string): Promise<{ value: unknown }> {
    assertKnown(key);
    const row = await this.prisma.store.findUnique({ where: { key } });
    return { value: row?.value ?? null };
  }

  @Put(':key')
  async write(
    @Param('key') key: string,
    @Body() body: { value?: unknown },
  ): Promise<{ value: unknown }> {
    assertKnown(key);
    // `undefined` is a client that forgot the field; `null` is a deliberate
    // "there is nothing here now", which is a real thing to want to say
    if (body.value === undefined) {
      throw new HttpException('value is required', 400);
    }
    const value = body.value as object;
    const row = await this.prisma.store.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
    return { value: row.value };
  }
}

function assertKnown(key: string): void {
  if (!KEYS.has(key)) {
    throw new HttpException(
      `unknown store key: ${key} (known: ${[...KEYS].join(', ')})`,
      400,
    );
  }
}
