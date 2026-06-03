import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SearchService } from '../search/search.service';
import { ChunkIndexService } from '../search/chunk-index.service';
import { RankedChunk } from '../search/types/search.types';

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
      where.filename = { contains: query, mode: 'insensitive' };
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

  async searchRelevant(
    query: string,
    userId: string,
    limit: number = 5,
  ): Promise<RankedChunk[]> {
    return this.searchService.searchForRag(query, userId, { limit });
  }
}
