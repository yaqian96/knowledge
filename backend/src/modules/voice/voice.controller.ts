import { Controller, Post, Body, Headers } from '@nestjs/common';
import { AsrService } from './asr.service';

@Controller('voice')
export class VoiceController {
  constructor(private asrService: AsrService) {}

  @Post('Transcribe')
  async transcribe(@Body() body: { audio: string }) {
    if (!body.audio) {
      throw new Error('No audio data provided');
    }
    const text = await this.asrService.transcribe(body.audio);
    return { text };
  }
}
