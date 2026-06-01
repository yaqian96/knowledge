import { Module } from '@nestjs/common';
import { AsrService } from './asr.service';
import { TtsService } from './tts.service';
import { VoiceController } from './voice.controller';
import { VoiceGateway } from './voice.gateway';

@Module({
  imports: [],
  controllers: [VoiceController],
  providers: [AsrService, TtsService, VoiceGateway],
  exports: [AsrService, TtsService, VoiceGateway],
})
export class VoiceModule {}
