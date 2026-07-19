import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { LlmController } from './llm.controller';
import { SttController } from './stt.controller';
import { RequestsController } from './requests.controller';
import { RatesController } from './rates.controller';
import { PrismaService } from './prisma.service';

@Module({
  imports: [],
  controllers: [
    AppController,
    LlmController,
    SttController,
    RequestsController,
    RatesController,
  ],
  providers: [AppService, PrismaService],
})
export class AppModule {}
