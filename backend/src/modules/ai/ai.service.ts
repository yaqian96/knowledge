import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { KnowledgeService } from '../knowledge/knowledge.service';
import { MemoryService } from '../memory/memory.service';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { streamText } from 'ai';
import { Response } from 'express';

const dashscope = createOpenAICompatible({
  name: 'dashscope',
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
  apiKey: process.env.DASHSCOPE_API_KEY || 'sk-acc43b4d94b6476a866821940d092080',
});

const model = dashscope('qwen-plus');

@Injectable()
export class AiService {
  constructor(
    private prisma: PrismaService,
    private knowledgeService: KnowledgeService,
    private memoryService: MemoryService,
  ) {}

  async chatStream(userId: string, conversationId: string, userMessage: string, res: Response) {
    await this.memoryService.addMessage(conversationId, 'user', userMessage);

    const context = await this.memoryService.getContextForQuery(conversationId);
    const knowledge = await this.knowledgeService.searchRelevant(userMessage, userId);

    const systemPrompt = this.buildSystemPrompt(context, knowledge as any[]);

    const history = context.shortTerm || [];
    const messages: Array<{ role: 'user' | 'assistant'; content: string }> = [
      ...history.map((msg: any) => ({ role: msg.role as 'user' | 'assistant', content: msg.content })),
      { role: 'user', content: userMessage },
    ];

    let fullResponse = '';

    const result = streamText({
      model,
      system: systemPrompt,
      messages,
      temperature: 0.7,
      maxOutputTokens: 2048,
      onFinish: async ({ text }) => {
        await this.memoryService.addMessage(conversationId, 'assistant', text);
      },
    });

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    for await (const chunk of result.textStream) {
      fullResponse += chunk;
      res.write(`data: ${JSON.stringify({ text: chunk })}\n\n`);
    }

    res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
    res.end();
  }

  private buildSystemPrompt(context: any, knowledge: any[]): string {
    let prompt = `你是一个企业级知识库助手。基于知识库内容回答用户问题。`;

    if (knowledge.length > 0) {
      prompt += `\n\n相关知识库内容：\n`;
      knowledge.forEach((k: any, idx: number) => {
        prompt += `\n--- [文档 ${idx + 1}: ${k.filename}] ---\n${k.content}\n`;
      });
    }

    if (context.summary) {
      prompt += `\n\n对话摘要：${context.summary}`;
    }

    prompt += `\n\n请用中文回答，简洁明了。如果知识库中没有相关信息，请如实告知用户。`;

    return prompt;
  }
}
