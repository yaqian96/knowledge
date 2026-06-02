import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { EmbeddingCacheService } from './embedding-cache.service';

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);
  private readonly apiKey = process.env.DASHSCOPE_API_KEY || 'sk-acc43b4d94b6476a866821940d092080';
  private readonly apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';

  constructor(private readonly cache: EmbeddingCacheService) {}

  async getEmbedding(text: string): Promise<number[]> {
    // Try cache first
    const cached = await this.cache.get(text);
    if (cached) {
      this.logger.debug(`Embedding cache hit: "${text.substring(0, 30)}..."`);
      return cached;
    }

    this.logger.debug(`Embedding cache miss, calling API: "${text.substring(0, 30)}..."`);
    try {
      const response = await axios.post(
        this.apiUrl,
        {
          model: 'text-embedding-v1',
          input: {
            texts: [text],
          },
        },
        {
          headers: {
            'Authorization': `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
        },
      );

      if (response.data && response.data.output && response.data.output.embeddings) {
        const embedding = response.data.output.embeddings[0].embedding;
        // Cache the result
        await this.cache.set(text, embedding);
        return embedding;
      }

      throw new Error('Failed to get embedding');
    } catch (error) {
      this.logger.error('Embedding API error:', error.response?.data || error.message);
      throw new Error('向量化失败');
    }
  }

  async batchEmbedding(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    
    for (const text of texts) {
      const embedding = await this.getEmbedding(text);
      embeddings.push(embedding);
    }
    
    return embeddings;
  }
}
