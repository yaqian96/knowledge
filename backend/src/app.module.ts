import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './modules/prisma/prisma.module';
import { RedisModule } from './modules/redis/redis.module';
import { AuthModule } from './modules/auth/auth.module';
import { ConversationModule } from './modules/conversation/conversation.module';
import { KnowledgeModule } from './modules/knowledge/knowledge.module';
import { FileModule } from './modules/file/file.module';
import { MemoryModule } from './modules/memory/memory.module';
import { AiModule } from './modules/ai/ai.module';
import { VoiceModule } from './modules/voice/voice.module';
import { IngestModule } from './modules/ingest/ingest.module';
import { SourceConnectorModule } from './modules/source-connector/source-connector.module';
import { LangSmithModule } from './modules/langsmith/langsmith.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    RedisModule,
    AuthModule,
    ConversationModule,
    KnowledgeModule,
    FileModule,
    MemoryModule,
    AiModule,
    VoiceModule,
    IngestModule,
    SourceConnectorModule,
    LangSmithModule,
  ],
})
export class AppModule {}
