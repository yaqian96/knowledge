import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { ChunkIndexService } from '../search/chunk-index.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private prisma: PrismaService,
    private searchService: SearchService,
    private chunkIndexService: ChunkIndexService,
  ) {}

  async findAll(userId: string, query?: string) {
    const where: any = { userId };
    if (query) {
      where.OR = [
        { filename: { contains: query, mode: 'insensitive' } },
        { content: { contains: query, mode: 'insensitive' } },
      ];
    }
    return this.prisma.knowledgeDocument.findMany({
      where,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    return this.prisma.knowledgeDocument.findUnique({
      where: { id },
    });
  }

  async delete(id: string) {
    await this.chunkIndexService.removeDocument(id);
    return this.prisma.knowledgeDocument.delete({ where: { id } });
  }

  async searchRelevant(query: string, userId: string, limit: number = 8) {
    const hits = await this.searchService.searchForRag(query, userId, { limit });
    return hits.map((h) => ({
      id: h.chunkId,
      documentId: h.documentId,
      chunkIndex: h.chunkIndex,
      content: h.content,
      filename: h.filename,
      sourceProvider: h.sourceProvider,
      similarity: h.rerankScore ?? h.rrfScore ?? 0,
    }));
  }
}
