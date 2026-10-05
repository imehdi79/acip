import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  Param,
  Put,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from './prisma.service';

/** what the editor PUTs — its own `SavedProject`, minus the fields we derive */
interface ProjectBody {
  name?: unknown;
  savedAt?: unknown;
  document?: unknown;
  rates?: unknown;
  defaults?: unknown;
}

/** the editor's own shape, so a response can be used without translation */
interface ProjectPayload {
  id: string;
  name: string;
  savedAt: number;
  document: unknown;
  rates?: unknown;
  defaults?: unknown;
}

/**
 * Saved plans, server-side.
 *
 * The editor keeps writing to `localStorage` as well — the server is the
 * source of truth, the browser is a cache that keeps the app usable with no
 * network. So these endpoints are deliberately boring and idempotent: a PUT
 * with an id the server has never seen creates it, and the same PUT replayed
 * out of the client's offline queue is a no-op rather than a duplicate.
 *
 * Single tenant (user decision): one deployment is one office and everyone
 * sees the same list. Nothing here filters by a user, and nothing pretends to.
 */
@Controller('projects')
export class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every plan, newest first.
   *
   * Documents and all. They are the reason to ask — the editor caches what
   * comes back so the list can be opened offline — and a summary endpoint
   * would only mean a second round trip per plan the moment one is picked.
   */
  @Get()
  async list(): Promise<ProjectPayload[]> {
    const rows = await this.prisma.project.findMany({
      orderBy: { savedAt: 'desc' },
      take: 200,
    });
    return rows.map(toPayload);
  }

  @Get(':id')
  async one(@Param('id') id: string): Promise<ProjectPayload> {
    const row = await this.prisma.project.findUnique({ where: { id } });
    if (!row) throw new HttpException('no such plan', 404);
    return toPayload(row);
  }

  /**
   * Save a plan under the id the editor gave it.
   *
   * An upsert, not a create: the editor mints the id (and may have minted it
   * offline), reuses it across every save of the same plan, and replays queued
   * writes after a reconnect. Any of those can arrive at a server that has the
   * row already, and none of them is an error.
   */
  @Put(':id')
  async save(
    @Param('id') id: string,
    @Body() body: ProjectBody,
  ): Promise<ProjectPayload> {
    const name = typeof body.name === 'string' ? body.name.trim() : '';
    if (!name) throw new HttpException('name is required', 400);
    if (!body.document || typeof body.document !== 'object') {
      throw new HttpException('document is required', 400);
    }
    // the editor's clock, not ours: `savedAt` is when the user pressed Save,
    // which is what orders the list they are looking at. A plan saved offline
    // on Monday and synced on Friday is a Monday plan.
    const savedAt =
      typeof body.savedAt === 'number' && Number.isFinite(body.savedAt)
        ? new Date(body.savedAt)
        : new Date();

    const data = {
      name,
      savedAt,
      document: body.document as Prisma.InputJsonValue,
      // `DbNull` and not `null`: Prisma reads a bare null on a nullable Json
      // column as "leave it alone", so a plan that genuinely has no rates
      // would keep whichever ones it was last saved with
      rates: (body.rates ?? Prisma.DbNull) as Prisma.InputJsonValue,
      defaults: (body.defaults ?? Prisma.DbNull) as Prisma.InputJsonValue,
    };
    const row = await this.prisma.project.upsert({
      where: { id },
      create: { id, ...data },
      update: data,
    });
    return toPayload(row);
  }

  /**
   * Forget a plan.
   *
   * Deleting one that is already gone is success, not 404. The client queues
   * deletes while offline and replays them, and a replay that 404s would stick
   * in the queue forever retrying something already true.
   */
  @Delete(':id')
  async remove(@Param('id') id: string): Promise<{ deleted: boolean }> {
    const { count } = await this.prisma.project.deleteMany({ where: { id } });
    return { deleted: count > 0 };
  }
}

interface ProjectRow {
  id: string;
  name: string;
  savedAt: Date;
  document: unknown;
  rates: unknown;
  defaults: unknown;
}

/** epoch ms out, because that is what the editor stores and sorts on */
function toPayload(row: ProjectRow): ProjectPayload {
  const payload: ProjectPayload = {
    id: row.id,
    name: row.name,
    savedAt: row.savedAt.getTime(),
    document: row.document,
  };
  if (row.rates !== null) payload.rates = row.rates;
  if (row.defaults !== null) payload.defaults = row.defaults;
  return payload;
}
