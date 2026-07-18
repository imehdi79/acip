import {
  Body,
  Controller,
  Get,
  HttpException,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { PrismaService } from './prisma.service';

interface CreateRequestBody {
  kind?: unknown;
  text?: unknown;
  context?: unknown;
}

/**
 * The wishlist: REQUEST.LOG dispatches from the editor land here — one row
 * per thing a user asked for that the toolset couldn't deliver, so
 * "implement it later" has real usage data behind it.
 */
@Controller('requests')
export class RequestsController {
  constructor(private readonly prisma: PrismaService) {}

  @Post()
  create(@Body() body: CreateRequestBody) {
    const text = typeof body.text === 'string' ? body.text.trim() : '';
    if (!text) throw new HttpException('text is required', 400);
    return this.prisma.request.create({
      data: {
        kind:
          body.kind === 'missing-price' ? 'missing-price' : 'missing-feature',
        text,
        context: typeof body.context === 'string' ? body.context : null,
      },
    });
  }

  @Get()
  list(@Query('status') status?: string) {
    return this.prisma.request.findMany({
      where: status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: { status?: unknown }) {
    const status =
      body.status === 'done' ? 'done' : body.status === 'open' ? 'open' : null;
    if (!status)
      throw new HttpException("status must be 'open' or 'done'", 400);
    return this.prisma.request.update({
      where: { id: Number(id) },
      data: { status },
    });
  }
}
