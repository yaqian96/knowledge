import { Module } from '@nestjs/common';
import { EmbeddingService } from './embedding.service';
import { EmbeddingCacheService } from './embedding-cache.service';

@Module({
  providers: [EmbeddingCacheService, EmbeddingService],
  exports: [EmbeddingService, EmbeddingCacheService],
})
export class EmbeddingModule {}
