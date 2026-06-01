import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmbeddingService } from '../embedding/embedding.service';

@Injectable()
export class KnowledgeService {
  constructor(
    private prisma: PrismaService,
    private embeddingService: EmbeddingService,
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
    return this.prisma.knowledgeDocument.delete({ where: { id } });
  }

  async searchRelevant(query: string, userId: string, limit: number = 5) {
    try {
      const queryEmbedding = await this.embeddingService.getEmbedding(query);
      const embeddingString = `[${queryEmbedding.join(',')}]`;

      const results = await this.prisma.$queryRaw`
        SELECT dv."id", dv."documentId", dv."chunkIndex", dv."content", 
               kd."filename" AS "filename",
               (dv.embedding <=> ${embeddingString}::vector(1536)) AS similarity
        FROM "DocumentVector" dv
        JOIN "KnowledgeDocument" kd ON dv."documentId" = kd."id"
        WHERE kd."userId" = ${userId}
        ORDER BY (dv.embedding <=> ${embeddingString}::vector(1536)) ASC
        LIMIT ${limit}
      `;

      return results;
    } catch (error) {
      console.error('Vector search failed:', error);
      return this.fallbackSearch(query, userId, limit);
    }
  }

  private async fallbackSearch(query: string, userId: string, limit: number = 5) {
    console.log('Using fallback text search...');
    const documents = await this.prisma.knowledgeDocument.findMany({
      where: {
        userId,
        content: { contains: query, mode: 'insensitive' },
      },
      take: limit,
      select: { 
        id: true, 
        content: true, 
        filename: true 
      },
    });
    return documents.map(doc => ({
      ...doc,
      similarity: 0,
    }));
  }
}
