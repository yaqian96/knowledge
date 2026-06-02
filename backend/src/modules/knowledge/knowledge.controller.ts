import { Controller, Get, Delete, Param, Query, Headers } from '@nestjs/common';
import { KnowledgeService } from './knowledge.service';

@Controller('knowledge')
export class KnowledgeController {
  constructor(private knowledgeService: KnowledgeService) {}

  @Get()
  async findAll(@Headers('x-user-id') userId: string, @Query('q') query?: string) {
    return this.knowledgeService.findAll(userId, query);
  }

  @Get('search')
  async search(
    @Headers('x-user-id') userId: string,
    @Query('q') query: string,
    @Query('limit') limit: number = 5,
  ) {
    return this.knowledgeService.searchRelevant(query, userId, limit);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.knowledgeService.findOne(id);
  }

  @Delete(':id')
  async delete(@Param('id') id: string) {
    return this.knowledgeService.delete(id);
  }
}
