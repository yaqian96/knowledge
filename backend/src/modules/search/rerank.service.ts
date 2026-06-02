import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { RankedChunk } from './types/search.types';

interface RerankResultItem {
  index: number;
  relevance_score: number;
}

@Injectable()
export class RerankService {
  private readonly logger = new Logger(RerankService.name);
  private readonly apiKey = process.env.DASHSCOPE_API_KEY || '';
  private readonly apiUrl =
    'https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank';
  private readonly model = process.env.DASHSCOPE_RERANK_MODEL || 'gte-rerank';
  private readonly minScore = Number(process.env.SEARCH_MIN_RERANK_SCORE ?? 0.2);

  async rerank(
    query: string,
    candidates: RankedChunk[],
    topN: number,
  ): Promise<RankedChunk[]> {
    if (candidates.length === 0) return [];

    try {
      const documents = candidates.map(
        (c) => `${c.filename}\n${c.content.slice(0, 1024)}`,
      );

      const response = await axios.post(
        this.apiUrl,
        {
          model: this.model,
          input: { query, documents },
          parameters: {
            top_n: Math.min(topN, documents.length),
            return_documents: false,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          proxy: false,
          timeout: 60000,
        },
      );

      const results: RerankResultItem[] =
        response.data?.output?.results ?? [];

      const reranked: RankedChunk[] = [];
      for (const item of results) {
        const chunk = candidates[item.index];
        if (!chunk) continue;
        if (item.relevance_score < this.minScore) continue;
        reranked.push({
          ...chunk,
          rerankScore: item.relevance_score,
        });
      }

      return reranked.slice(0, topN);
    } catch (err) {
      this.logger.warn(
        `Rerank failed, using RRF order: ${err instanceof Error ? err.message : err}`,
      );
      return candidates.slice(0, topN);
    }
  }
}
