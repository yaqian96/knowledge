import { Injectable } from '@nestjs/common';
import * as crypto from 'crypto';

@Injectable()
export class TtsService {
  private readonly secretId = process.env.TENCENT_SECRET_ID || '';
  private readonly secretKey = process.env.TENCENT_SECRET_KEY || '';
  private readonly endpoint = 'tts.tencentcloudapi.com';

  constructor() {
    if (!this.secretId || !this.secretKey) {
      throw new Error('TENCENT_SECRET_ID and TENCENT_SECRET_KEY must be set in environment variables');
    }
  }

  async synthesize(text: string, voiceType = 101001): Promise<string> {
    const action = 'TextToVoice';
    const version = '2019-08-23';
    const region = 'ap-guangzhou';
    const timestamp = Math.floor(Date.now() / 1000);
    const timestampStr = timestamp.toString();
    const sessionId = `session_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    const date = new Date(timestamp * 1000).toISOString().slice(0, 10);

    const body = {
      Text: text,
      SessionId: sessionId,
      VoiceType: voiceType,
      Codec: 'mp3',
    };

    const bodyStr = JSON.stringify(body);
    const hashedPayload = this.sha256(bodyStr);

    const canonicalHeaders =
      `content-type:application/json; charset=utf-8\nhost:${this.endpoint}\nx-tc-action:${action.toLowerCase()}\n`;
    const signedHeaders = 'content-type;host;x-tc-action';

    const canonicalRequest =
      `POST\n/\n\n${canonicalHeaders}\n${signedHeaders}\n${hashedPayload}`;
    const hashedCanonicalRequest = this.sha256(canonicalRequest);

    const credentialScope = `${date}/tts/tc3_request`;
    const stringToSign =
      `TC3-HMAC-SHA256\n${timestampStr}\n${credentialScope}\n${hashedCanonicalRequest}`;

    const secretDate = this.hmac('TC3' + this.secretKey, date);
    const secretService = this.hmac(secretDate, 'tts');
    const secretSigning = this.hmac(secretService, 'tc3_request');
    const signature = crypto
      .createHmac('sha256', secretSigning)
      .update(stringToSign)
      .digest('hex');

    const authorization =
      `TC3-HMAC-SHA256 Credential=${this.secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    const res = await fetch(`https://${this.endpoint}`, {
      method: 'POST',
      headers: {
        Authorization: authorization,
        'Content-Type': 'application/json; charset=utf-8',
        Host: this.endpoint,
        'X-TC-Action': action,
        'X-TC-Version': version,
        'X-TC-Region': region,
        'X-TC-Timestamp': timestampStr,
      },
      body: bodyStr,
    });

    const json = await res.json();

    if (json.Response?.Audio) {
      return json.Response.Audio;
    }
    if (json.Response?.Error) {
      throw new Error(`TTS error: ${json.Response.Error.Message}`);
    }
    throw new Error('TTS unknown error');
  }

  private sha256(str: string): string {
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  private hmac(key: Buffer | string, data: string): Buffer {
    return crypto.createHmac('sha256', key).update(data).digest();
  }
}
