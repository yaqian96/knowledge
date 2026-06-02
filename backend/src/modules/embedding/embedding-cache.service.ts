import { Injectable, Logger } from '@nestjs/common';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class EmbeddingCacheService {
  private readonly logger = new Logger(EmbeddingCacheService.name);
  private client: RedisClientType;
  private enabled = false;
  private readonly ttl = Number(process.env.EMBEDDING_CACHE_TTL ?? 86400); // 24h
  private readonly keyPrefix = 'emb:';

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (!redisUrl) {
      this.logger.warn('REDIS_URL not configured, embedding cache disabled');
      return;
    }

    try {
      this.client = createClient({ url: redisUrl });
      this.client.on('error', (err) => {
        this.logger.error(`Redis cache error: ${err.message}`);
      });
      await this.client.connect();
      this.enabled = this.client.isOpen;
      if (this.enabled) {
        this.logger.log(`Embedding cache enabled (TTL: ${this.ttl}s)`);
      }
    } catch (err) {
      this.logger.warn(`Redis cache init failed: ${err.message}`);
    }
  }

  async onModuleDestroy() {
    if (this.client?.isOpen) {
      await this.client.quit();
    }
  }

  async get(query: string): Promise<number[] | null> {
    if (!this.enabled) return null;

    try {
      const key = this.cacheKey(query);
      const cached = await this.client.get(key);
      if (cached) {
        this.logger.debug(`Embedding cache HIT for: ${query.substring(0, 30)}...`);
        return JSON.parse(cached);
      }
      return null;
    } catch (err) {
      this.logger.warn(`Cache get failed: ${err.message}`);
      return null;
    }
  }

  async set(query: string, embedding: number[]): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = this.cacheKey(query);
      await this.client.set(key, JSON.stringify(embedding), { EX: this.ttl });
      this.logger.debug(`Embedding cache SET for: ${query.substring(0, 30)}...`);
    } catch (err) {
      this.logger.warn(`Cache set failed: ${err.message}`);
    }
  }

  async clear(): Promise<void> {
    if (!this.enabled) return;

    try {
      const keys = await this.client.keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.client.del(keys);
        this.logger.log(`Cleared ${keys.length} embedding cache entries`);
      }
    } catch (err) {
      this.logger.warn(`Cache clear failed: ${err.message}`);
    }
  }

  private cacheKey(query: string): string {
    const hash = this.simpleHash(query);
    return `${this.keyPrefix}${hash}`;
  }

  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}
