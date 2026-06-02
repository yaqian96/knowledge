import { Module } from '@nestjs/common';
import { EmbeddingModule } from '../embedding/embedding.module';
import { SearchModule } from '../search/search.module';
import { ContentChunkerService } from './content-chunker.service';
import { DocumentIngestService } from './document-ingest.service';

@Module({
  imports: [EmbeddingModule, SearchModule],
  providers: [ContentChunkerService, DocumentIngestService],
  exports: [ContentChunkerService, DocumentIngestService],
})
export class IngestModule {}
