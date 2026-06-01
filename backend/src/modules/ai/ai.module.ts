import { Module } from '@nestjs/common';
import { KnowledgeModule } from '../knowledge/knowledge.module';
import { MemoryModule } from '../memory/memory.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [KnowledgeModule, MemoryModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
