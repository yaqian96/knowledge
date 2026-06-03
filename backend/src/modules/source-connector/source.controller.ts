import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { IsArray, IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ConnectorRegistry } from './connector.registry';
import { CredentialService } from './credential.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { PrismaService } from '../prisma/prisma.service';
import { wrapYoudaoApiError } from './youdao-api.error';
import { SyncCronScheduler } from '../scheduler/sync-cron.scheduler';
import { SyncCronStore } from '../scheduler/sync-cron.store';
import { YoudaoCookieConnector } from './providers/youdao/youdao-cookie.connector';

class PasteYoudaoCookieDto {
  @IsString()
  @IsNotEmpty()
  cookie: string;
}

class SaveYoudaoCredentialDto {
  @IsString()
  @IsNotEmpty()
  cookie: string;

  @IsString()
  @IsNotEmpty()
  cstk: string;
}

class UpdateSyncJobDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  cronExpr?: string;
}

class RunSyncDto {
  @IsOptional()
  @IsBoolean()
  syncAll?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  targetIds?: string[];

  @IsOptional()
  batchSize?: number;

  @IsOptional()
  batchDelayMs?: number;
}

@Controller('sources')
export class SourceController {
  constructor(
    private registry: ConnectorRegistry,
    private credentialService: CredentialService,
    private syncOrchestrator: SyncOrchestratorService,
    private prisma: PrismaService,
    private syncCronScheduler: SyncCronScheduler,
    private syncCronStore: SyncCronStore,
  ) {}

  @Get('providers')
  listProviders() {
    return this.registry.listProviders();
  }

  @Get('accounts')
  listAccounts(@Headers('x-user-id') userId: string) {
    return this.credentialService.listAccounts(userId);
  }

  @Delete('accounts/:id')
  deleteAccount(
    @Headers('x-user-id') userId: string,
    @Param('id') id: string,
  ) {
    return this.credentialService.deleteAccount(userId, id);
  }

  @Post('youdao/login')
  async pasteYoudaoCookie(
    @Headers('x-user-id') userId: string,
    @Body() dto: PasteYoudaoCookieDto,
  ) {
    if (!userId?.trim()) {
      throw new BadRequestException('缺少请求头 x-user-id');
    }
    await this.ensureUser(userId.trim());

    // Auto-extract cstk from the cookie string
    const { cookie, cstk } = YoudaoCookieConnector.parseCookieAndCstK(
      dto.cookie.trim(),
    );

    const account = await this.credentialService.saveCredential(
      userId,
      'youdao',
      'cookie',
      { cookie, cstk },
    );

    const syncJob = await this.prisma.syncJob.upsert({
      where: { userId_provider: { userId, provider: 'youdao' } },
      create: { userId, provider: 'youdao', enabled: true },
      update: { enabled: true },
    });

    await this.syncCronScheduler.reconcileJob(syncJob.id);

    return {
      id: account.id,
      provider: account.provider,
      authMethod: account.authMethod,
      message: '有道云笔记已连接',
    };
  }

  @Post('youdao/credentials')
  async saveYoudaoCredentials(
    @Headers('x-user-id') userId: string,
    @Body() dto: SaveYoudaoCredentialDto,
  ) {
    if (!userId?.trim()) {
      throw new BadRequestException('缺少请求头 x-user-id');
    }
    await this.ensureUser(userId.trim());

    const account = await this.credentialService.saveCredential(
      userId,
      'youdao',
      'cookie',
      { cookie: dto.cookie.trim(), cstk: dto.cstk.trim() },
    );

    const syncJob = await this.prisma.syncJob.upsert({
      where: { userId_provider: { userId, provider: 'youdao' } },
      create: { userId, provider: 'youdao', enabled: true },
      update: { enabled: true },
    });

    await this.syncCronScheduler.reconcileJob(syncJob.id);

    return {
      id: account.id,
      provider: account.provider,
      authMethod: account.authMethod,
      message: '有道云笔记凭据已保存',
    };
  }

  @Get('youdao/targets')
  async listYoudaoTargets(
    @Headers('x-user-id') userId: string,
    @Query('parentId') parentId?: string,
  ) {
    const account = await this.credentialService.getAccount(userId, 'youdao', 'cookie');
    if (!account) {
      return { connected: false, targets: [] };
    }

    const connector = this.registry.get('youdao');
    try {
      const targets = await connector.listTargets(account, parentId);
      return { connected: true, targets };
    } catch (err) {
      wrapYoudaoApiError(err);
    }
  }

  @Get('youdao/notes')
  async listYoudaoNotes(@Headers('x-user-id') userId: string) {
    const account = await this.credentialService.getAccount(userId, 'youdao', 'cookie');
    if (!account) {
      return { connected: false, notes: [] };
    }

    const connector = this.registry.get('youdao');
    try {
      const notes = connector.listAllNotes
        ? await connector.listAllNotes(account)
        : [];
      return { connected: true, notes, total: notes.length };
    } catch (err) {
      wrapYoudaoApiError(err);
    }
  }

  @Get('youdao/sync-config')
  async getYoudaoSyncConfig(@Headers('x-user-id') userId: string) {
    const job = await this.prisma.syncJob.findUnique({
      where: { userId_provider: { userId, provider: 'youdao' } },
    });

    return {
      connected: !!(await this.credentialService.getAccount(userId, 'youdao', 'cookie')),
      job: job
        ? {
            id: job.id,
            enabled: job.enabled,
            cronExpr: job.cronExpr,
            lastSyncAt: job.lastSyncAt,
          }
        : null,
      defaultCronExpr: '0 */1 * * *',
    };
  }

  @Post('youdao/sync')
  async syncYoudao(
    @Headers('x-user-id') userId: string,
    @Body() dto: RunSyncDto,
  ) {
    try {
      return await this.syncOrchestrator.syncUserProvider(userId, 'youdao', {
        syncAll: dto.syncAll ?? true,
        targetIds: dto.targetIds,
        batchSize: dto.batchSize,
        batchDelayMs: dto.batchDelayMs,
      });
    } catch (err) {
      wrapYoudaoApiError(err);
    }
  }

  @Post('sync/run')
  async runSync(
    @Headers('x-user-id') userId: string,
    @Query('provider') provider: string,
    @Body() dto: RunSyncDto,
  ) {
    return this.syncOrchestrator.syncUserProvider(userId, provider, {
      syncAll: dto.syncAll ?? true,
      targetIds: dto.targetIds,
      batchSize: dto.batchSize,
      batchDelayMs: dto.batchDelayMs,
    });
  }

  @Patch('sync/jobs/:id')
  async updateSyncJob(
    @Headers('x-user-id') userId: string,
    @Param('id') id: string,
    @Body() dto: UpdateSyncJobDto,
  ) {
    const job = await this.prisma.syncJob.findFirst({
      where: { id, userId },
    });
    if (!job) {
      throw new BadRequestException('同步任务不存在');
    }

    if (dto.cronExpr !== undefined && !this.isValidCronExpr(dto.cronExpr)) {
      throw new BadRequestException(
        'cron 表达式无效，示例：0 */1 * * *（每小时）、0 8 * * *（每天8点）',
      );
    }

    const updated = await this.prisma.syncJob.update({
      where: { id },
      data: {
        enabled: dto.enabled ?? job.enabled,
        cronExpr: dto.cronExpr ?? job.cronExpr,
      },
    });

    await this.syncCronScheduler.reconcileJob(updated.id);
    return updated;
  }

  @Post('sync/reconcile')
  async reconcileCron(@Headers('x-user-id') userId: string) {
    await this.syncCronScheduler.reconcileAllFromDatabase();
    const store = await this.syncCronStore.load();
    return {
      message: '已从数据库重建 BullMQ Cron 与本地任务文件',
      storePath: this.syncCronStore.getStorePath(),
      jobCount: store.jobs.length,
    };
  }

  @Get('sync/status')
  async syncStatus(@Headers('x-user-id') userId: string) {
    const jobs = await this.prisma.syncJob.findMany({
      where: { userId },
      include: {
        targets: { take: 10, orderBy: { updatedAt: 'desc' } },
      },
    });

    const runs = await this.prisma.syncRun.findMany({
      where: { syncJobId: { in: jobs.map((j) => j.id) } },
      orderBy: { startedAt: 'desc' },
      take: 10,
    });

    return { jobs, runs };
  }

  private isValidCronExpr(expr: string): boolean {
    const parts = expr.trim().split(/\s+/);
    return parts.length === 5 || parts.length === 6;
  }

  private async ensureUser(userId: string) {
    const existing = await this.prisma.user.findUnique({ where: { id: userId } });
    if (existing) return existing;

    if (userId === 'demo-user') {
      return this.prisma.user.upsert({
        where: { id: 'demo-user' },
        create: {
          id: 'demo-user',
          username: 'demo-user',
          email: 'demo@example.com',
          password: '$2b$10$placeholder',
        },
        update: {},
      });
    }

    throw new BadRequestException(`用户 ${userId} 不存在，请先注册或执行 scripts/fix-demo-user.sql`);
  }
}
