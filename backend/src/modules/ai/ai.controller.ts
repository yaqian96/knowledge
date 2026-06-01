import { Controller, Post, Param, Body, Headers, Res } from '@nestjs/common';
import { Response } from 'express';
import { AiService } from './ai.service';

@Controller('ai')
export class AiController {
  constructor(private aiService: AiService) {}

  @Post('chat/:conversationId')
  async chat(
    @Param('conversationId') conversationId: string,
    @Headers('x-user-id') userId: string,
    @Body() body: { message: string },
    @Res() res: Response,
  ) {
    await this.aiService.chatStream(userId, conversationId, body.message, res);
  }
}
