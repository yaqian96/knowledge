import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';

@Injectable()
export class MemoryService {
  private readonly SHORT_TTL = 86400;
  private readonly MAX_TOKENS = 4000;

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async addMessage(conversationId: string, role: string, content: string) {
    const message = await this.prisma.message.create({
      data: { conversationId, role, content },
    });

    await this.updateShortTermMemory(conversationId, role, content);

    return message;
  }

  async updateShortTermMemory(conversationId: string, role: string, content: string) {
    const key = `memory:short:${conversationId}`;
    const memoryData = await this.redis.get(key);
    
    let memory: any = {
      messages: [],
      summary: '',
      contextTokens: 0,
      updatedAt: new Date().toISOString(),
    };

    if (memoryData) {
      memory = JSON.parse(memoryData);
    }

    memory.messages.push({ role, content, timestamp: new Date().toISOString() });
    memory.contextTokens += this.estimateTokens(content);

    if (memory.contextTokens > this.MAX_TOKENS) {
      memory = await this.truncateAndSummarize(memory);
    }

    memory.updatedAt = new Date().toISOString();
    await this.redis.set(key, JSON.stringify(memory), this.SHORT_TTL);
  }

  async getShortTermMemory(conversationId: string) {
    const key = `memory:short:${conversationId}`;
    const data = await this.redis.get(key);
    return data ? JSON.parse(data) : null;
  }

  async getLongTermMemory(conversationId: string, limit: number = 20) {
    return this.prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });
  }

  async getContextForQuery(
    conversationId: string,
    options?: { lightweight?: boolean },
  ) {
    const shortTerm = await this.getShortTermMemory(conversationId);
    const messages = shortTerm?.messages || [];

    if (options?.lightweight && messages.length > 0) {
      return {
        shortTerm: messages,
        longTerm: [],
        summary: shortTerm?.summary || '',
      };
    }

    const longTerm = await this.getLongTermMemory(conversationId);

    return {
      shortTerm: messages,
      longTerm,
      summary: shortTerm?.summary || '',
    };
  }

  private async truncateAndSummarize(memory: any) {
    const recentMessages = memory.messages.slice(-10);
    const summary = `Conversation with ${memory.messages.length} messages. Recent topics: ${recentMessages.map(m => m.content.substring(0, 50)).join('; ')}`;
    
    return {
      messages: recentMessages,
      summary,
      contextTokens: recentMessages.reduce((sum: number, m: any) => sum + this.estimateTokens(m.content), 0),
      updatedAt: memory.updatedAt,
    };
  }

  private estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }
}
