import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { ElasticsearchService } from './elasticsearch.service';
import { VectorSearchService } from './vector-search.service';
import { RrfService } from './rrf.service';
import { RerankService } from './rerank.service';
import { ChunkIndexService } from './chunk-index.service';
import { SearchService } from './search.service';

@Module({
  imports: [EmbeddingModule],
  providers: [
    ElasticsearchService,
    VectorSearchService,
    RrfService,
    RerankService,
    ChunkIndexService,
    SearchService,
  ],
  exports: [SearchService, ChunkIndexService],
})
export class SearchModule {}
