import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { RankedChunk } from './types/search.types';

@Injectable()
export class VectorSearchService {
  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
  ) {}

  async search(
    query: string,
    userId: string,
    limit: number,
  ): Promise<{ hits: RankedChunk[]; rankedIds: { id: string; rank: number }[] }> {
    const queryEmbedding = await this.embeddingService.getEmbedding(query);
    const embeddingString = `[${queryEmbedding.join(',')}]`;

    // 使用原生 vector 类型，HNSW 索引会自动加速余弦相似度搜索
    const rows = await this.prisma.$queryRaw<
      {
        id: string;
        documentId: string;
        chunkIndex: number;
        content: string;
        filename: string;
        sourceProvider: string;
        similarity: number;
      }[]
    >`
      SELECT dv."id", dv."documentId", dv."chunkIndex", dv."content",
             kd."filename", kd."sourceProvider",
             (dv.embedding <=> ${embeddingString}::vector(1536)) AS similarity
      FROM "DocumentVector" dv
      JOIN "KnowledgeDocument" kd ON dv."documentId" = kd."id"
      WHERE kd."userId" = ${userId}
      ORDER BY (dv.embedding <=> ${embeddingString}::vector(1536)) ASC
      LIMIT ${limit}
    `;

    const hits: RankedChunk[] = rows.map((r) => ({
      chunkId: r.id,
      documentId: r.documentId,
      chunkIndex: r.chunkIndex,
      filename: r.filename,
      content: r.content,
      sourceProvider: r.sourceProvider,
    }));

    const rankedIds = hits.map((h, i) => ({ id: h.chunkId, rank: i + 1 }));
    return { hits, rankedIds };
  }
}
