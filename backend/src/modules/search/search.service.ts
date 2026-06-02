import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ElasticsearchService } from './elasticsearch.service';
import { VectorSearchService } from './vector-search.service';
import { RrfService } from './rrf.service';
import { RerankService } from './rerank.service';
import { RankedChunk, SearchOptions } from './types/search.types';

@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);
  private readonly kBm25 = Number(process.env.SEARCH_K_BM25 ?? 30);
  private readonly kVector = Number(process.env.SEARCH_K_VECTOR ?? 30);
  private readonly rrfK = Number(process.env.SEARCH_RRF_K ?? 60);
  private readonly rrfTopN = Number(process.env.SEARCH_RRF_TOP_N ?? 20);
  private readonly rerankTopM = Number(process.env.SEARCH_RERANK_TOP_M ?? 8);

  constructor(
    private prisma: PrismaService,
    private elasticsearch: ElasticsearchService,
    private vectorSearch: VectorSearchService,
    private rrf: RrfService,
    private rerank: RerankService,
  ) {}

  async searchForRag(
    query: string,
    userId: string,
    options?: SearchOptions,
  ): Promise<RankedChunk[]> {
    const finalLimit = options?.limit ?? this.rerankTopM;
    const skipRerank = options?.skipRerank ?? false;

    const hitMap = new Map<string, RankedChunk>();
    const rankings: { id: string; rank: number }[][] = [];

    const [bm25Result, vectorResult] = await Promise.allSettled([
      this.searchBm25(query, userId),
      this.vectorSearch.search(query, userId, this.kVector),
    ]);

    if (bm25Result.status === 'fulfilled') {
      for (const hit of bm25Result.value.hits) {
        hitMap.set(hit.chunkId, hit);
      }
      if (bm25Result.value.rankedIds.length > 0) {
        rankings.push(bm25Result.value.rankedIds);
      }
    } else {
      this.logger.warn(`BM25 search failed: ${bm25Result.reason}`);
    }

    if (vectorResult.status === 'fulfilled') {
      for (const hit of vectorResult.value.hits) {
        if (!hitMap.has(hit.chunkId)) {
          hitMap.set(hit.chunkId, hit);
        }
      }
      if (vectorResult.value.rankedIds.length > 0) {
        rankings.push(vectorResult.value.rankedIds);
      }
    } else {
      this.logger.warn(`Vector search failed: ${vectorResult.reason}`);
    }

    if (rankings.length === 0) {
      return this.fallbackKeywordSearch(query, userId, finalLimit);
    }

    const rrfScores = this.rrf.fuse(rankings, this.rrfK);
    const topIds = this.rrf.topIds(rrfScores, this.rrfTopN);

    const candidates: RankedChunk[] = [];
    for (const id of topIds) {
      const hit = hitMap.get(id);
      if (hit) {
        candidates.push({ ...hit, rrfScore: rrfScores.get(id) });
      }
    }

    if (candidates.length === 0) {
      return this.fallbackKeywordSearch(query, userId, finalLimit);
    }

    if (skipRerank) {
      return candidates.slice(0, finalLimit);
    }

    return this.rerank.rerank(query, candidates, finalLimit);
  }

  private async searchBm25(
    query: string,
    userId: string,
  ): Promise<{ hits: RankedChunk[]; rankedIds: { id: string; rank: number }[] }> {
    if (!this.elasticsearch.isEnabled()) {
      return { hits: [], rankedIds: [] };
    }

    return this.elasticsearch.searchBm25(query, userId, this.kBm25);
  }

  private async fallbackKeywordSearch(
    query: string,
    userId: string,
    limit: number,
  ): Promise<RankedChunk[]> {
    const vectors = await this.prisma.documentVector.findMany({
      where: {
        document: {
          userId,
          OR: [
            { filename: { contains: query, mode: 'insensitive' } },
            { content: { contains: query, mode: 'insensitive' } },
          ],
        },
      },
      take: limit,
      include: {
        document: {
          select: { filename: true, sourceProvider: true },
        },
      },
      orderBy: { chunkIndex: 'asc' },
    });

    return vectors.map((v) => ({
      chunkId: v.id,
      documentId: v.documentId,
      chunkIndex: v.chunkIndex,
      filename: v.document.filename,
      content: v.content,
      sourceProvider: v.document.sourceProvider,
    }));
  }
}
