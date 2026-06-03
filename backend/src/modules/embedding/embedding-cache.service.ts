import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class EmbeddingCacheService {
  private readonly logger = new Logger(EmbeddingCacheService.name);
  private readonly enabled = !!process.env.REDIS_URL;
  private readonly ttl = Number(process.env.EMBEDDING_CACHE_TTL ?? 86400);
  private readonly keyPrefix = 'emb:';

  constructor(private readonly redis: RedisService) {
    if (this.enabled) {
      this.logger.log(`Embedding cache enabled (TTL: ${this.ttl}s)`);
    } else {
      this.logger.warn('REDIS_URL not configured, embedding cache disabled');
    }
  }

  async get(query: string): Promise<number[] | null> {
    if (!this.enabled) return null;

    try {
      const key = this.cacheKey(query);
      const cached = await this.redis.get(key);
      if (cached) {
        this.logger.debug(`Embedding cache HIT for: ${query.substring(0, 30)}...`);
        return JSON.parse(cached);
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Cache get failed: ${err instanceof Error ? err.message : err}`,
      );
      return null;
    }
  }

  async set(query: string, embedding: number[]): Promise<void> {
    if (!this.enabled) return;

    try {
      const key = this.cacheKey(query);
      await this.redis.set(key, JSON.stringify(embedding), this.ttl);
      this.logger.debug(`Embedding cache SET for: ${query.substring(0, 30)}...`);
    } catch (err) {
      this.logger.warn(
        `Cache set failed: ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  async clear(): Promise<void> {
    if (!this.enabled) return;

    try {
      const keys = await this.redis.getClient().keys(`${this.keyPrefix}*`);
      if (keys.length > 0) {
        await this.redis.getClient().del(...keys);
        this.logger.log(`Cleared ${keys.length} embedding cache entries`);
      }
    } catch (err) {
      this.logger.warn(
        `Cache clear failed: ${err instanceof Error ? err.message : err}`,
      );
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
      hash = (hash << 5) - hash + char;
      hash |= 0;
    }
    return Math.abs(hash).toString(36);
  }
}
