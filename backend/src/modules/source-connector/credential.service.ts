import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { SourceAccount } from '@prisma/client';
import { CredentialPayload } from './types/connector.interface';

@Injectable()
export class CredentialService {
  private readonly key: Buffer;

  constructor(
    private prisma: PrismaService,
    config: ConfigService,
  ) {
    const secret = config.get<string>('ENCRYPTION_KEY') ?? 'dev-encryption-key-change-me';
    this.key = createHash('sha256').update(secret).digest();
  }

  encrypt(payload: CredentialPayload): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const data = Buffer.from(JSON.stringify(payload), 'utf8');
    const encrypted = Buffer.concat([cipher.update(data), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, encrypted]).toString('base64');
  }

  decrypt(encryptedPayload: string): CredentialPayload {
    const buf = Buffer.from(encryptedPayload, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const data = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return JSON.parse(decrypted.toString('utf8'));
  }

  async saveCredential(
    userId: string,
    provider: string,
    authMethod: string,
    payload: CredentialPayload,
    expiresAt?: Date,
  ): Promise<SourceAccount> {
    const encryptedPayload = this.encrypt(payload);

    return this.prisma.sourceAccount.upsert({
      where: {
        userId_provider_authMethod: { userId, provider, authMethod },
      },
      create: {
        userId,
        provider,
        authMethod,
        encryptedPayload,
        expiresAt,
      },
      update: {
        encryptedPayload,
        expiresAt,
      },
    });
  }

  getPayload(account: SourceAccount): CredentialPayload {
    return this.decrypt(account.encryptedPayload);
  }

  async getAccount(
    userId: string,
    provider: string,
    authMethod = 'cookie',
  ): Promise<SourceAccount | null> {
    return this.prisma.sourceAccount.findUnique({
      where: { userId_provider_authMethod: { userId, provider, authMethod } },
    });
  }

  async listAccounts(userId: string) {
    return this.prisma.sourceAccount.findMany({
      where: { userId },
      select: {
        id: true,
        provider: true,
        authMethod: true,
        expiresAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  }

  async deleteAccount(userId: string, accountId: string) {
    return this.prisma.sourceAccount.deleteMany({
      where: { id: accountId, userId },
    });
  }
}
