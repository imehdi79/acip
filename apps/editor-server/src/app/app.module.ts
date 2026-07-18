import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmController } from './llm.controller';
import { SttController } from './stt.controller';
import { RequestsController } from './requests.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    LlmController,
    SttController,
    RequestsController,
  ],
  providers: [AppService, PrismaService],
})
export class AppModule {}
