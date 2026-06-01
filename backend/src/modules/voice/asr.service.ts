import { Injectable } from '@nestjs/common';
import { asr } from 'tencentcloud-sdk-nodejs-asr';

const AsrClient = asr.v20190614.Client;

@Injectable()
export class AsrService {
  private readonly client: any;

  constructor() {
    const secretId = process.env.TENCENT_SECRET_ID;
    const secretKey = process.env.TENCENT_SECRET_KEY;
    if (!secretId || !secretKey) {
      throw new Error('TENCENT_SECRET_ID and TENCENT_SECRET_KEY must be set in environment variables');
    }
    this.client = new AsrClient({
      credential: {
        secretId,
        secretKey,
      },
      region: 'ap-guangzhou',
      profile: {
        signMethod: 'TC3-HMAC-SHA256',
        httpProfile: {
          endpoint: 'asr.tencentcloudapi.com',
          reqTimeout: 30,
        },
      },
    });
  }

  async transcribe(pcmBase64: string): Promise<string> {
    const pcmBuffer = Buffer.from(pcmBase64, 'base64');

    const params = {
      ProjectId: 0,
      SubServiceType: 2,
      SourceType: 1,
      VoiceFormat: 'pcm',
      DataLen: pcmBuffer.length,
      Data: pcmBase64,
      EngSerViceType: '16k_zh',
    };

    const resp = await this.client.SentenceRecognition(params);
    return resp.Result || '';
  }
}
