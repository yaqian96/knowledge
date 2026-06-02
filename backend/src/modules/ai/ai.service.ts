import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MemoryService } from '../memory/memory.service';
import { LangSmithService } from '../langsmith/langsmith.service';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { Response } from 'express';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY || '',
});

const model = dashscope('qwen-plus');

@Injectable()
export class AiService implements OnModuleInit {
  private readonly logger = new Logger(AiService.name);
  private searchRelevantTraced!: (
    query: string,
    userId: string,
  ) => ReturnType<KnowledgeService['searchRelevant']>;

  constructor(
    private knowledgeService: KnowledgeService,
    private memoryService: MemoryService,
    private langSmith: LangSmithService,
  ) {}

  async onModuleInit() {
    this.searchRelevantTraced = await this.langSmith.wrapRetriever(
      (query: string, userId: string) =>
        this.knowledgeService.searchRelevant(query, userId, 8),
      'knowledge-hybrid-search',
    );
  }

  async chatStream(
    userId: string,
    conversationId: string,
    userMessage: string,
    res: Response,
  ) {
    await this.memoryService.addMessage(conversationId, 'user', userMessage);

    const context = await this.memoryService.getContextForQuery(conversationId);
    const knowledge = await this.searchRelevantTraced(userMessage, userId);

    const systemPrompt = this.buildSystemPrompt(context, knowledge as any[]);

    const history = context.shortTerm || [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.map((msg: any) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content,
      })),
      { role: 'user', content: userMessage },
    ];

    const streamText = this.langSmith.getStreamText();
    const streamOptions: Parameters<typeof streamText>[0] = {
      model,
      system: systemPrompt,
      messages,
      temperature: 0.7,
      maxOutputTokens: 2048,
      onFinish: async ({ text }) => {
        await this.memoryService.addMessage(conversationId, 'assistant', text);
      },
    };

    if (this.langSmith.isEnabled()) {
      const { createLangSmithProviderOptions } = await import(
        'langsmith/experimental/vercel'
      );
      streamOptions.providerOptions = {
        langsmith: createLangSmithProviderOptions({
          name: 'knowledge-chat',
          metadata: {
            user_id: userId,
            conversation_id: conversationId,
            knowledge_chunks: knowledge.length,
          },
          tags: ['knowledge-base', 'qwen-plus'],
        }),
      };
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
      try {
        await this.langSmith.flush();
      } catch (err) {
        this.logger.warn(
          `LangSmith flush failed: ${err instanceof Error ? err.message : err}`,
        );
      }
    }
  }

  private buildSystemPrompt(context: any, knowledge: any[]): string {
    let prompt = `你是一个企业级知识库助手。基于知识库内容回答用户问题。`;

    if (knowledge.length > 0) {
      prompt += `\n\n相关知识库内容（已按相关度排序，多块来自同一文档时请综合理解）：\n`;
      knowledge.forEach((k: any, idx: number) => {
        const source =
          k.sourceProvider && k.sourceProvider !== 'upload'
            ? k.sourceProvider
            : '知识库';
        prompt += `\n--- [片段 ${idx + 1} | 文档: ${k.filename} | 来源: ${source}] ---\n${k.content}\n`;
      });
    }

    if (context.summary) {
      prompt += `\n\n对话摘要：${context.summary}`;
    }

    prompt += `\n\n请用中文回答，简洁明了。如果知识库中没有相关信息，请如实告知用户。`;

    return prompt;
  }
}
