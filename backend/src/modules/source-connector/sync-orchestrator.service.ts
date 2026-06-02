import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConnectorRegistry } from './connector.registry';
import { CredentialService } from './credential.service';
import { DocumentIngestService } from '../ingest/document-ingest.service';
import { RemoteTarget } from './types/connector.interface';

export interface SyncOptions {
  syncAll?: boolean;
  targetIds?: string[];
  batchSize?: number;
  batchDelayMs?: number;
}

export interface SyncResult {
  total: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: { externalId: string; title: string; error: string }[];
}

@Injectable()
export class SyncOrchestratorService {
  private readonly logger = new Logger(SyncOrchestratorService.name);
  private readonly defaultBatchSize = 3;
  private readonly defaultBatchDelayMs = 800;
  private readonly itemDelayMs = 400;

  constructor(
    private prisma: PrismaService,
    private registry: ConnectorRegistry,
    private credentialService: CredentialService,
    private ingestService: DocumentIngestService,
  ) {}

  async syncUserProvider(
    userId: string,
    provider: string,
    options?: SyncOptions,
  ): Promise<SyncResult> {
    const account = await this.credentialService.getAccount(userId, provider, 'cookie');
    if (!account) {
      throw new Error(`未绑定 ${provider} 账号，请先配置凭据`);
    }

    const connector = this.registry.get(provider);
    let targets: RemoteTarget[] = [];

    if (options?.targetIds?.length) {
      const allNotes = connector.listAllNotes
        ? await connector.listAllNotes(account)
        : await this.collectAllNotes(connector, account);
      const idSet = new Set(options.targetIds);
      targets = allNotes.filter((t) => idSet.has(t.externalId));
    } else if (options?.syncAll !== false) {
      targets = connector.listAllNotes
        ? await connector.listAllNotes(account)
        : await this.collectAllNotes(connector, account);
    }

    targets = targets.filter((t) => t.externalId && !t.isFolder);

    const batchSize = options?.batchSize ?? this.defaultBatchSize;
    const batchDelayMs = options?.batchDelayMs ?? this.defaultBatchDelayMs;

    const result: SyncResult = {
      total: targets.length,
      succeeded: 0,
      failed: 0,
      skipped: 0,
      errors: [],
    };

    const job = await this.prisma.syncJob.upsert({
      where: { userId_provider: { userId, provider } },
      create: { userId, provider, enabled: true },
      update: { lastSyncAt: new Date() },
    });

    const run = await this.prisma.syncRun.create({
      data: {
        syncJobId: job.id,
        status: 'running',
        total: targets.length,
      },
    });

    for (let i = 0; i < targets.length; i += batchSize) {
      const batch = targets.slice(i, i + batchSize);
      this.logger.log(
        `同步批次 ${Math.floor(i / batchSize) + 1}/${Math.ceil(targets.length / batchSize)}，本批 ${batch.length} 篇`,
      );

      for (const target of batch) {
        await this.syncOneTarget(
          userId,
          provider,
          connector,
          account,
          job.id,
          target,
          result,
        );
        await this.delay(this.itemDelayMs);
      }

      if (i + batchSize < targets.length) {
        await this.delay(batchDelayMs);
      }
    }

    await this.prisma.syncJob.update({
      where: { id: job.id },
      data: { lastSyncAt: new Date() },
    });

    await this.prisma.syncRun.update({
      where: { id: run.id },
      data: {
        status: result.failed === 0 ? 'completed' : 'partial',
        succeeded: result.succeeded,
        failed: result.failed,
        finishedAt: new Date(),
        message:
          result.errors.length > 0
            ? result.errors.slice(0, 8).map((e) => `${e.title}: ${e.error}`).join('; ')
            : null,
      },
    });

    return result;
  }

  private async syncOneTarget(
    userId: string,
    provider: string,
    connector: {
      fetchDocument: (account: unknown, target: RemoteTarget) => Promise<{
        externalId: string;
        title: string;
        content: string;
        contentHash: string;
        externalUrl?: string;
      }>;
    },
    account: unknown,
    syncJobId: string,
    target: RemoteTarget,
    result: SyncResult,
  ): Promise<void> {
    try {
      if (!target.title?.trim()) {
        result.skipped++;
        return;
      }

      const doc = await connector.fetchDocument(account as never, target);
      if (!doc.content?.trim()) {
        result.failed++;
        result.errors.push({
          externalId: target.externalId,
          title: target.title,
          error: '解析后内容为空',
        });
        return;
      }

      await this.ingestService.upsertByExternalId({
        userId,
        title: doc.title,
        content: doc.content,
        sourceProvider: provider,
        externalId: doc.externalId,
        externalUrl: doc.externalUrl,
        contentHash: doc.contentHash,
        fileType: 'markdown',
      });

      await this.prisma.syncTarget.upsert({
        where: {
          syncJobId_externalId: {
            syncJobId,
            externalId: target.externalId,
          },
        },
        create: {
          syncJobId,
          externalId: target.externalId,
          title: target.title,
          parentId: target.parentId,
          syncStatus: 'synced',
        },
        update: {
          title: target.title,
          syncStatus: 'synced',
          lastError: null,
        },
      });

      result.succeeded++;
      this.logger.log(`同步成功: ${target.title}`);
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push({
        externalId: target.externalId,
        title: target.title,
        error: message,
      });
      this.logger.warn(`同步失败 ${target.title}: ${message}`);

      await this.prisma.syncTarget.upsert({
        where: {
          syncJobId_externalId: {
            syncJobId,
            externalId: target.externalId,
          },
        },
        create: {
          syncJobId,
          externalId: target.externalId,
          title: target.title,
          syncStatus: 'failed',
          lastError: message,
        },
        update: {
          syncStatus: 'failed',
          lastError: message,
        },
      });
    }
  }

  private async collectAllNotes(
    connector: { listTargets: (a: unknown, p?: string) => Promise<RemoteTarget[]> },
    account: unknown,
  ): Promise<RemoteTarget[]> {
    const rootItems = await connector.listTargets(account, undefined);
    const notes: RemoteTarget[] = [];

    const walk = async (parentId: string) => {
      const children = await connector.listTargets(account, parentId);
      for (const child of children) {
        if (child.isFolder) {
          await walk(child.externalId);
        } else if (child.externalId) {
          notes.push(child);
        }
      }
    };

    for (const item of rootItems) {
      if (item.isFolder) {
        await walk(item.externalId);
      } else if (item.externalId) {
        notes.push(item);
      }
    }

    return notes;
  }

  private delay(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
