import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { MemoryService } from '../memory/memory.service';
import { LangSmithService } from '../langsmith/langsmith.service';
import { SearchService } from '../search/search.service';
import { RankedChunk } from '../search/types/search.types';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Response } from 'express';

const RAG_TOP_K = Number(process.env.CHAT_RAG_TOP_K ?? process.env.SEARCH_RERANK_TOP_M ?? 5);
const RAG_CHUNK_MAX_CHARS = Number(process.env.CHAT_RAG_CHUNK_MAX_CHARS ?? 500);
const CHAT_MAX_OUTPUT_TOKENS = Number(process.env.CHAT_MAX_OUTPUT_TOKENS ?? 1024);
const CHAT_MAX_HISTORY_MESSAGES = Number(process.env.CHAT_MAX_HISTORY_MESSAGES ?? 10);
const CHAT_MODEL_ID = process.env.CHAT_MODEL ?? 'qwen-turbo';
const CHAT_SKIP_RERANK =
  process.env.CHAT_SKIP_RERANK === 'true' ||
  process.env.SEARCH_SKIP_RERANK === 'true';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
});

const model = dashscope(CHAT_MODEL_ID);

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private searchForRagTraced!: (
    query: string,
    userId: string,
  ) => Promise<RankedChunk[]>;
  private createLangSmithOptions:
    | ((config: {
        name: string;
        metadata?: Record<string, unknown>;
        tags?: string[];
      }) => object)
    | undefined;

  constructor(
    private searchService: SearchService,
    private memoryService: MemoryService,
    private langSmith: LangSmithService,
  ) {}

  async onModuleInit() {
    this.searchForRagTraced = await this.langSmith.wrapRetriever(
      (query: string, userId: string) =>
        this.searchService.searchForRag(query, userId, {
          limit: RAG_TOP_K,
          skipRerank: CHAT_SKIP_RERANK,
        }),
      'knowledge-hybrid-search',
    );

    if (this.langSmith.isEnabled()) {
      const { createLangSmithProviderOptions } = await import(
        'langsmith/experimental/vercel'
      );
      this.createLangSmithOptions = createLangSmithProviderOptions;
    }
  }

  async chatStream(
    userId: string,
    conversationId: string,
    userMessage: string,
    res: Response,
  ) {
    await this.memoryService.addMessage(conversationId, 'user', userMessage);

    const [context, knowledge] = await Promise.all([
      this.memoryService.getContextForQuery(conversationId, { lightweight: true }),
      this.searchForRagTraced(userMessage, userId),
    ]);

    const systemPrompt = this.buildSystemPrompt(context, knowledge);
    const messages = this.buildMessages(context.shortTerm || [], userMessage);

    const streamText = this.langSmith.getStreamText();
    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages,
      temperature: 0.7,
      maxOutputTokens: CHAT_MAX_OUTPUT_TOKENS,
      onFinish: ({ text }) => {
        void this.memoryService
          .addMessage(conversationId, 'assistant', text)
          .catch((err) => {
            this.logger.warn(
              `Failed to save assistant message: ${err instanceof Error ? err.message : err}`,
            );
          });
      },
    };

    if (this.createLangSmithOptions) {
      streamOptions.providerOptions = {
        langsmith: this.createLangSmithOptions({
          name: 'knowledge-chat',
          metadata: {
            user_id: userId,
            conversation_id: conversationId,
            knowledge_chunks: knowledge.length,
            model: CHAT_MODEL_ID,
          },
          tags: ['knowledge-base', CHAT_MODEL_ID],
        }),
      } as Parameters<typeof streamText>[0]['providerOptions'];
    }

    const result = streamText(streamOptions);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    try {
      for await (const chunk of result.textStream) {
        res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    } finally {
      res.end();
      void this.langSmith.flush().catch((err) => {
        this.logger.warn(
          `LangSmith flush failed: ${err instanceof Error ? err.message : err}`,
        );
      });
    }
  }

  private buildMessages(
    shortTerm: Array<{ role: string; content: string }>,
    userMessage: string,
  ): Array<{ role: 'user' | 'assistant'; content: string }> {
    const history = shortTerm.slice(-CHAT_MAX_HISTORY_MESSAGES).map((msg) => ({
      role: msg.role as 'user' | 'assistant',
      content: msg.content,
    }));

    const last = history[history.length - 1];
    if (last?.role === 'user' && last.content === userMessage) {
      return history;
    }

    return [...history, { role: 'user' as const, content: userMessage }];
  }

  private buildSystemPrompt(
    context: { summary?: string },
    knowledge: RankedChunk[],
  ): string {
    let prompt = `你是企业级知识库助手。基于下列检索片段回答，简洁准确。`;

    if (knowledge.length > 0) {
      prompt += `\n\n【检索片段】\n`;
      knowledge.forEach((k, idx) => {
        const source =
          k.sourceProvider && k.sourceProvider !== 'upload'
            ? k.sourceProvider
            : '知识库';
        const body =
          k.content.length > RAG_CHUNK_MAX_CHARS
            ? `${k.content.slice(0, RAG_CHUNK_MAX_CHARS)}…`
            : k.content;
        prompt += `\n[${idx + 1}] ${k.filename}（${source}）\n${body}\n`;
      });
    }

    if (context.summary) {
      prompt += `\n【对话摘要】${context.summary}`;
    }

    prompt += `\n\n无相关内容时如实说明。用中文回答。`;

    return prompt;
  }
}
