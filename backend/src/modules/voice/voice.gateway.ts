import { Injectable } from '@nestjs/common';
import { WebSocketServer, WebSocket } from 'ws';
import { TtsService } from './tts.service';

@Injectable()
export class VoiceGateway {
  private wss: WebSocketServer;

  constructor(private ttsService: TtsService) {}

  init(server: any) {
    this.wss = new WebSocketServer({ server, path: '/ws/tts' });
    console.log('Voice WebSocket gateway initialized at /ws/tts');

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('Client connected to voice WS');

      ws.on('message', async (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());

          if (msg.type === 'tts') {
            ws.send(JSON.stringify({ type: 'tts_start' }));

            // Split text into sentences for streaming
            const sentences = this.splitSentences(msg.text);
            const voiceType = msg.voiceType || 101001;

            for (const sentence of sentences) {
              try {
                const audioBase64 = await this.ttsService.synthesize(sentence, voiceType);
                ws.send(JSON.stringify({
                  type: 'tts_chunk',
                  audio: audioBase64,
                }));
              } catch (e) {
                ws.send(JSON.stringify({
                  type: 'tts_error',
                  message: e.message,
                }));
              }
            }

            ws.send(JSON.stringify({ type: 'tts_complete' }));
          }
        } catch (error) {
          console.error('WS error:', error);
        }
      });
    });
  }

  private splitSentences(text: string): string[] {
    // Split by Chinese sentence terminators
    const parts = text.split(/(?<=[。！？.!?])/);
    return parts.filter(p => p.trim().length > 0);
  }
}
