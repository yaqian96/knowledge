import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { SyncOrchestratorService } from '../source-connector/sync-orchestrator.service';
import { getBullMqConnection } from './bullmq-connection';
import { SyncCronStore } from './sync-cron.store';
import {
  SOURCE_SYNC_QUEUE,
  SourceSyncJobPayload,
  SyncCronJobDef,
} from './sync-cron.types';

@Injectable()
export class SyncCronScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncCronScheduler.name);
  private readonly enabled = process.env.SYNC_CRON_ENABLED !== 'false';
  private readonly timezone =
    process.env.SYNC_CRON_TIMEZONE || 'Asia/Shanghai';
  private readonly concurrency = Number(
    process.env.SYNC_CRON_CONCURRENCY ?? 1,
  );
  private readonly startupDelayMs = Number(
    process.env.SYNC_CRON_STARTUP_DELAY_MS ?? 30_000,
  );
  private readonly runOnStartup =
    process.env.SYNC_CRON_RUN_ON_STARTUP !== 'false';

  private queue: Queue<SourceSyncJobPayload> | null = null;
  private worker: Worker<SourceSyncJobPayload> | null = null;
  private running = false;

  constructor(
    private prisma: PrismaService,
    private syncOrchestrator: SyncOrchestratorService,
    private cronStore: SyncCronStore,
  ) {}

  async onModuleInit() {
    if (!this.enabled) {
      this.logger.log('BullMQ 定时同步已关闭 (SYNC_CRON_ENABLED=false)');
      return;
    }

    const connection = getBullMqConnection();
    this.queue = new Queue<SourceSyncJobPayload>(SOURCE_SYNC_QUEUE, {
      connection,
    });

    this.worker = new Worker<SourceSyncJobPayload>(
      SOURCE_SYNC_QUEUE,
      async (job) => this.handleJob(job.data),
      { connection, concurrency: this.concurrency },
    );

    this.worker.on('failed', (job, err) => {
      this.logger.error(
        `同步任务失败 ${job?.data?.provider} user=${job?.data?.userId}: ${err.message}`,
      );
    });

    await this.reconcileAllFromDatabase();

    if (this.runOnStartup) {
      await this.scheduleStartupRuns();
    }

    this.logger.log(
      `BullMQ Cron 已启动 queue=${SOURCE_SYNC_QUEUE} store=${this.cronStore.getStorePath()} tz=${this.timezone}`,
    );
  }

  async onModuleDestroy() {
    await this.worker?.close();
    await this.queue?.close();
  }

  /** 从 DB 全量对齐：写本地 jobs.json + 注册/更新 BullMQ repeatable */
  async reconcileAllFromDatabase(): Promise<void> {
    const rows = await this.prisma.syncJob.findMany();
    const defs: SyncCronJobDef[] = rows.map((row) => ({
      id: row.id,
      userId: row.userId,
      provider: row.provider,
      enabled: row.enabled,
      cronExpr: row.cronExpr || '0 */1 * * *',
      timezone: this.timezone,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    }));

    await this.cronStore.save(defs);

    if (!this.queue) return;

    const repeatable = await this.queue.getRepeatableJobs();
    for (const item of repeatable) {
      await this.queue.removeRepeatableByKey(item.key);
    }

    for (const def of defs) {
      if (def.enabled) {
        await this.registerRepeatable(def);
      }
    }
  }

  /** 单条 SyncJob 变更后调用（保存凭据、改 cron、启停） */
  async reconcileJob(syncJobId: string): Promise<void> {
    const row = await this.prisma.syncJob.findUnique({
      where: { id: syncJobId },
    });
    if (!row) return;

    const def: SyncCronJobDef = {
      id: row.id,
      userId: row.userId,
      provider: row.provider,
      enabled: row.enabled,
      cronExpr: row.cronExpr || '0 */1 * * *',
      timezone: this.timezone,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    };

    const store = await this.cronStore.load();
    const next = store.jobs.filter((j) => j.id !== def.id);
    next.push(def);
    await this.cronStore.save(next);

    if (!this.queue) return;

    await this.removeRepeatableFor(def.userId, def.provider);
    if (def.enabled) {
      await this.registerRepeatable(def);
    }
  }

  private repeatableJobId(userId: string, provider: string): string {
    return `cron:${userId}:${provider}`;
  }

  private async registerRepeatable(def: SyncCronJobDef): Promise<void> {
    if (!this.queue) return;

    await this.queue.add(
      'sync-provider',
      {
        syncJobId: def.id,
        userId: def.userId,
        provider: def.provider,
        trigger: 'cron',
      },
      {
        jobId: this.repeatableJobId(def.userId, def.provider),
        repeat: {
          pattern: def.cronExpr,
          tz: def.timezone,
        },
        removeOnComplete: 50,
        removeOnFail: 100,
        attempts: 3,
        backoff: { type: 'exponential', delay: 60_000 },
      },
    );

    this.logger.log(
      `已注册 Cron ${def.provider} user=${def.userId} expr="${def.cronExpr}" tz=${def.timezone}`,
    );
  }

  private async removeRepeatableFor(
    userId: string,
    provider: string,
  ): Promise<void> {
    if (!this.queue) return;

    const repeatable = await this.queue.getRepeatableJobs();
    const prefix = this.repeatableJobId(userId, provider);
    for (const item of repeatable) {
      if (item.id === prefix || item.key.includes(prefix)) {
        await this.queue.removeRepeatableByKey(item.key);
      }
    }
  }

  private async scheduleStartupRuns(): Promise<void> {
    if (!this.queue) return;

    const store = await this.cronStore.load();
    for (const def of store.jobs.filter((j) => j.enabled)) {
      await this.queue.add(
        'sync-provider',
        {
          syncJobId: def.id,
          userId: def.userId,
          provider: def.provider,
          trigger: 'startup',
        },
        {
          delay: this.startupDelayMs,
          jobId: `startup:${def.userId}:${def.provider}:${Date.now()}`,
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
    this.logger.log(
      `已安排启动后 ${this.startupDelayMs}ms 执行首轮同步 (${store.jobs.filter((j) => j.enabled).length} 个任务)`,
    );
  }

  private async handleJob(payload: SourceSyncJobPayload): Promise<void> {
    if (this.running) {
      this.logger.warn('上一轮同步仍在进行，跳过本次触发');
      return;
    }

    this.running = true;
    try {
      this.logger.log(
        `BullMQ 触发同步 [${payload.trigger}] ${payload.provider} user=${payload.userId}`,
      );
      await this.syncOrchestrator.syncUserProvider(
        payload.userId,
        payload.provider,
        { syncAll: true },
      );
    } finally {
      this.running = false;
    }
  }
}
