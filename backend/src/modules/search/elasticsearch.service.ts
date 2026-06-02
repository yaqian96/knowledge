import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Client } from '@elastic/elasticsearch';
import { ChunkIndexDoc, RankedChunk } from './types/search.types';

@Injectable()
export class ElasticsearchService implements OnModuleInit {
  private readonly logger = new Logger(ElasticsearchService.name);
  private client: Client | null = null;
  private readonly node = process.env.ELASTICSEARCH_NODE || 'http://localhost:9200';
  private readonly index = process.env.ELASTICSEARCH_INDEX || 'knowledge_chunks';
  private enabled = process.env.SEARCH_ES_ENABLED !== 'false';

  isEnabled(): boolean {
    return this.enabled && this.client !== null;
  }

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.warn('Elasticsearch disabled (SEARCH_ES_ENABLED=false)');
      return;
    }

    try {
      this.client = new Client({ node: this.node });
      await this.client.ping();
      await this.ensureIndex();
      this.logger.log(`Elasticsearch connected: ${this.node}, index=${this.index}`);
    } catch (err) {
      this.logger.warn(`Elasticsearch unavailable (${this.node}), BM25 search disabled`);
      this.client = null;
    }
  }

  private async ensureIndex() {
    if (!this.client) return;

    const exists = await this.client.indices.exists({ index: this.index });
    if (exists) return;

    try {
      await this.client.indices.create({
        index: this.index,
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: this.buildMappings(true),
      });
    } catch {
      this.logger.warn('IK analyzer unavailable, falling back to standard analyzer');
      await this.client.indices.create({
        index: this.index,
        settings: { number_of_shards: 1, number_of_replicas: 0 },
        mappings: this.buildMappings(false),
      });
    }
  }

  private buildMappings(useIk: boolean) {
    const textField = useIk
      ? { type: 'text' as const, analyzer: 'ik_max_word', search_analyzer: 'ik_smart' }
      : { type: 'text' as const };

    return {
      properties: {
        chunkId: { type: 'keyword' as const },
        documentId: { type: 'keyword' as const },
        chunkIndex: { type: 'integer' as const },
        userId: { type: 'keyword' as const },
        filename: {
          ...textField,
          fields: { keyword: { type: 'keyword' as const } },
        },
        content: textField,
        fileType: { type: 'keyword' as const },
        sourceProvider: { type: 'keyword' as const },
        createdAt: { type: 'date' as const },
      },
    };
  }

  async indexChunks(docs: ChunkIndexDoc[]): Promise<void> {
    if (!this.client || docs.length === 0) return;

    const operations = docs.flatMap((doc) => [
      { index: { _index: this.index, _id: doc.chunkId } },
      {
        chunkId: doc.chunkId,
        documentId: doc.documentId,
        chunkIndex: doc.chunkIndex,
        userId: doc.userId,
        filename: doc.filename,
        content: doc.content,
        fileType: doc.fileType,
        sourceProvider: doc.sourceProvider,
        createdAt: doc.createdAt ?? new Date().toISOString(),
      },
    ]);

    const result = await this.client.bulk({ refresh: true, operations });
    if (result.errors) {
      const failed = result.items?.filter((i) => i.index?.error).length ?? 0;
      this.logger.warn(`ES bulk index: ${failed} failures`);
    }
  }

  async deleteByDocumentId(documentId: string): Promise<void> {
    if (!this.client) return;

    await this.client.deleteByQuery({
      index: this.index,
      refresh: true,
      query: { term: { documentId } },
    });
  }

  async searchBm25(
    query: string,
    userId: string,
    limit: number,
  ): Promise<{
    hits: RankedChunk[];
    rankedIds: { id: string; rank: number }[];
  }> {
    if (!this.client) return { hits: [], rankedIds: [] };

    const res = await this.client.search({
      index: this.index,
      size: limit,
      query: {
        bool: {
          filter: [{ term: { userId } }],
          should: [
            {
              multi_match: {
                query,
                fields: ['filename^3', 'content'],
                type: 'best_fields',
                fuzziness: 'AUTO',
              },
            },
            {
              match_phrase: {
                content: { query, boost: 1.5 },
              },
            },
          ],
          minimum_should_match: 1,
        },
      },
      _source: ['chunkId', 'documentId', 'chunkIndex', 'filename', 'content', 'sourceProvider'],
    });

    const hits: RankedChunk[] = [];
    const rankedIds: { id: string; rank: number }[] = [];

    res.hits.hits.forEach((hit, i) => {
      const src = hit._source as ChunkIndexDoc;
      hits.push({
        chunkId: src.chunkId,
        documentId: src.documentId,
        chunkIndex: src.chunkIndex,
        filename: src.filename,
        content: src.content,
        sourceProvider: src.sourceProvider,
      });
      rankedIds.push({ id: src.chunkId, rank: i + 1 });
    });

    return { hits, rankedIds };
  }

  async getChunksByIds(
    chunkIds: string[],
    userId: string,
  ): Promise<Map<string, ChunkIndexDoc>> {
    const map = new Map<string, ChunkIndexDoc>();
    if (!this.client || chunkIds.length === 0) return map;

    const res = await this.client.mget({
      index: this.index,
      ids: chunkIds,
    });

    for (const doc of res.docs) {
      if ('found' in doc && doc.found && doc._source) {
        const src = doc._source as ChunkIndexDoc;
        if (src.userId === userId) {
          map.set(src.chunkId, src);
        }
      }
    }
    return map;
  }
}
