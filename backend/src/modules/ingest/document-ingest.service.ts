import { Injectable } from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { ContentChunkerService } from './content-chunker.service';
import { ChunkIndexService, ChunkRow, DocumentMeta } from '../search/chunk-index.service';

export interface IngestInput {
  userId: string;
  title: string;
  content: string;
  sourceProvider?: string;
  externalId?: string;
  externalUrl?: string;
  contentHash?: string;
  fileType?: string;
  filePath?: string;
}

@Injectable()
export class DocumentIngestService {
  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
    private chunker: ContentChunkerService,
    private chunkIndexService: ChunkIndexService,
  ) {}

  hashContent(content: string): string {
    return createHash('md5').update(content).digest('hex');
  }

  async ingest(input: IngestInput) {
    const sourceProvider = input.sourceProvider ?? 'upload';
    const fileType = input.fileType ?? 'text';
    const content = this.normalizeContent(input.content);
    const contentHash = input.contentHash ?? this.hashContent(content);
    const chunks = this.chunker.chunk(content, fileType, input.title, 40);

    const document = await this.prisma.knowledgeDocument.create({
      data: {
        userId: input.userId,
        filename: input.title,
        fileType,
        filePath: input.filePath ?? '',
        content,
        chunks: JSON.stringify(chunks),
        sourceProvider,
        externalId: input.externalId,
        externalUrl: input.externalUrl,
        contentHash,
        syncedAt: sourceProvider !== 'upload' ? new Date() : null,
      },
    });

    await this.createDocumentVectors(
      {
        id: document.id,
        userId: document.userId,
        filename: document.filename,
        fileType: document.fileType,
        sourceProvider: document.sourceProvider,
      },
      chunks,
    );
    return document;
  }

  async upsertByExternalId(input: IngestInput) {
    if (!input.externalId) {
      return this.ingest(input);
    }

    const sourceProvider = input.sourceProvider ?? 'youdao';
    const content = this.normalizeContent(input.content);
    const contentHash = input.contentHash ?? this.hashContent(content);

    const existing = await this.prisma.knowledgeDocument.findFirst({
      where: {
        userId: input.userId,
        sourceProvider,
        externalId: input.externalId,
      },
    });

    if (existing && existing.contentHash === contentHash) {
      return existing;
    }

    if (existing) {
      await this.chunkIndexService.removeDocument(existing.id);
      await this.prisma.documentVector.deleteMany({ where: { documentId: existing.id } });
      const fileType = input.fileType ?? 'markdown';
      const chunks = this.chunker.chunk(content, fileType, input.title, 40);

      const updated = await this.prisma.knowledgeDocument.update({
        where: { id: existing.id },
        data: {
          filename: input.title,
          content,
          chunks: JSON.stringify(chunks),
          contentHash,
          externalUrl: input.externalUrl,
          syncedAt: new Date(),
        },
      });

      await this.createDocumentVectors(
        {
          id: updated.id,
          userId: updated.userId,
          filename: updated.filename,
          fileType: updated.fileType,
          sourceProvider: updated.sourceProvider,
        },
        chunks,
      );
      return updated;
    }

    return this.ingest({ ...input, content, sourceProvider, contentHash });
  }

  private normalizeContent(content: string): string {
    const max = 100_000;
    if (content.length <= max) return content;
    return `${content.slice(0, max)}\n\n[内容已截断]`;
  }

  private async createDocumentVectors(
    document: DocumentMeta,
    chunks: { content: string }[],
  ): Promise<void> {
    const texts = chunks.map((c) => c.content);
    const embeddings = await this.embeddingService.batchEmbedding(texts);
    const chunkRows: ChunkRow[] = [];

    for (let index = 0; index < chunks.length; index++) {
      const chunk = chunks[index];
      const embedding = embeddings[index];
      const id = randomUUID();

      await this.prisma.$executeRaw`
        INSERT INTO "DocumentVector" ("id", "documentId", "chunkIndex", "content", "embedding")
        VALUES (${id}, ${document.id}, ${index}, ${chunk.content}, ${JSON.stringify(embedding)}::vector(1536))
      `;

      chunkRows.push({ id, chunkIndex: index, content: chunk.content });
    }

    await this.chunkIndexService.indexDocumentChunks(document, chunkRows);
  }
}
