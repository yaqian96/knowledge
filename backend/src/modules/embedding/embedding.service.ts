import { Injectable } from '@nestjs/common';
import axios from 'axios';

@Injectable()
export class EmbeddingService {
  private readonly apiKey = process.env.DASHSCOPE_API_KEY || 'sk-acc43b4d94b6476a866821940d092080';
  private readonly apiUrl = 'https://dashscope.aliyuncs.com/api/v1/services/embeddings/text-embedding/text-embedding';

  async getEmbedding(text: string): Promise<number[]> {
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
            Authorization: `Bearer ${this.apiKey}`,
            'Content-Type': 'application/json',
          },
          proxy: false,
          timeout: 60000,
        },
      );

      if (response.data && response.data.output && response.data.output.embeddings) {
        return response.data.output.embeddings[0].embedding;
      }

      throw new Error('Failed to get embedding');
    } catch (error) {
      console.error('Embedding API error:', error.response?.data || error.message);
      throw new Error('向量化失败');
    }
  }

  async batchEmbedding(texts: string[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const batchSize = 10;

    for (let i = 0; i < texts.length; i += batchSize) {
      const batch = texts.slice(i, i + batchSize).map((t) => t.slice(0, 8000));
      const response = await axios.post(
        this.apiUrl,
        {
          model: 'text-embedding-v1',
          input: { texts: batch },
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

      if (response.data?.output?.embeddings) {
        for (const item of response.data.output.embeddings) {
          embeddings.push(item.embedding);
        }
      } else {
        throw new Error('Failed to get batch embedding');
      }
    }

    return embeddings;
  }
}
