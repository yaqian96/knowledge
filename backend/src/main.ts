import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import * as bodyParser from 'body-parser';
import { AppModule } from './app.module';
import { VoiceGateway } from './modules/voice/voice.gateway';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    bodyParser: false,
  });
  
  // Increase body size limit for audio data (50MB)
  app.use(bodyParser.json({ limit: '50mb' }));
  app.use(bodyParser.urlencoded({ limit: '50mb', extended: true }));
  
  app.enableCors();
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
  }));
  
  const port = process.env.PORT || 3000;
  const httpServer = app.getHttpServer();
  
  // Initialize WebSocket gateway for TTS streaming
  const voiceGateway = app.get(VoiceGateway);
  voiceGateway.init(httpServer);
  
  await app.listen(port);
  console.log(`Server running on http://localhost:${port}`);
  console.log(`Voice WebSocket available at ws://localhost:${port}/ws/tts`);
}
bootstrap();
