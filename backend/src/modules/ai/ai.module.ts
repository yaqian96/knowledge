import { Module } from '@nestjs/common';
import { MemoryModule } from '../memory/memory.module';
import { SearchModule } from '../search/search.module';
import { AiService } from './ai.service';
import { AiController } from './ai.controller';

@Module({
  imports: [SearchModule, MemoryModule],
  controllers: [AiController],
  providers: [AiService],
  exports: [AiService],
})
export class AiModule {}
