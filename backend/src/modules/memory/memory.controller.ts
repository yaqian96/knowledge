import { Controller, Get, Param, Headers } from '@nestjs/common';
import { MemoryService } from './memory.service';

@Controller('memory')
export class MemoryController {
  constructor(private memoryService: MemoryService) {}

  @Get(':conversationId/short')
  async getShortTerm(@Param('conversationId') conversationId: string) {
    return this.memoryService.getShortTermMemory(conversationId);
  }

  @Get(':conversationId/long')
  async getLongTerm(@Param('conversationId') conversationId: string) {
    return this.memoryService.getLongTermMemory(conversationId);
  }

  @Get(':conversationId/context')
  async getContext(@Param('conversationId') conversationId: string) {
    return this.memoryService.getContextForQuery(conversationId);
  }
}
