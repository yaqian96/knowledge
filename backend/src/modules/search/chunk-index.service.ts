import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from './elasticsearch.service';
import { ChunkIndexDoc } from './types/search.types';

export interface ChunkRow {
  id: string;
  chunkIndex: number;
  content: string;
}

export interface DocumentMeta {
  id: string;
  userId: string;
  filename: string;
  fileType: string;
  sourceProvider: string;
}

@Injectable()
export class ChunkIndexService {
  private readonly logger = new Logger(ChunkIndexService.name);

  constructor(private elasticsearch: ElasticsearchService) {}

  async indexDocumentChunks(
    document: DocumentMeta,
    chunks: ChunkRow[],
  ): Promise<void> {
    if (!this.elasticsearch.isEnabled()) return;

    try {
      await this.elasticsearch.deleteByDocumentId(document.id);

      const docs: ChunkIndexDoc[] = chunks.map((c) => ({
        chunkId: c.id,
        documentId: document.id,
        chunkIndex: c.chunkIndex,
        userId: document.userId,
        filename: document.filename,
        content: c.content,
        fileType: document.fileType,
        sourceProvider: document.sourceProvider,
      }));

      await this.elasticsearch.indexChunks(docs);
    } catch (err) {
      this.logger.warn(
        `ES index failed for document ${document.id}: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async removeDocument(documentId: string): Promise<void> {
    if (!this.elasticsearch.isEnabled()) return;
    try {
      await this.elasticsearch.deleteByDocumentId(documentId);
    } catch (err) {
      this.logger.warn(`ES delete failed for ${documentId}`);
    }
  }
}
