import { Controller, Get, Post, Delete, Param, Body, Headers } from '@nestjs/common';
import { ConversationService } from './conversation.service';

@Controller('conversations')
export class ConversationController {
  constructor(private conversationService: ConversationService) {}

  @Post()
  async create(@Headers('x-user-id') userId: string, @Body() body: { title: string }) {
    return this.conversationService.create(userId, body.title);
  }

  @Get()
  async findAll(@Headers('x-user-id') userId: string) {
    return this.conversationService.findAllByUser(userId);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.conversationService.findOne(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.conversationService.delete(id);
  }
}
