import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, rename, writeFile } from 'fs/promises';
import { dirname, resolve } from 'path';
import { SyncCronJobDef, SyncCronStoreFile } from './sync-cron.types';

@Injectable()
export class SyncCronStore {
  private readonly logger = new Logger(SyncCronStore.name);
  private readonly storePath = resolve(
    process.cwd(),
    process.env.SYNC_CRON_STORE || 'data/sync-cron-jobs.json',
  );

  getStorePath(): string {
    return this.storePath;
  }

  async load(): Promise<SyncCronStoreFile> {
    try {
      const raw = await readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw) as SyncCronStoreFile;
      if (parsed?.version === 1 && Array.isArray(parsed.jobs)) {
        return parsed;
      }
    } catch {
      // 文件不存在或损坏，返回空存储
    }
    return { version: 1, updatedAt: new Date().toISOString(), jobs: [] };
  }

  async save(jobs: SyncCronJobDef[]): Promise<SyncCronStoreFile> {
    const payload: SyncCronStoreFile = {
      version: 1,
      updatedAt: new Date().toISOString(),
      jobs,
    };
    await mkdir(dirname(this.storePath), { recursive: true });
    const tmp = `${this.storePath}.tmp`;
    await writeFile(tmp, JSON.stringify(payload, null, 2), 'utf8');
    await rename(tmp, this.storePath);
    this.logger.debug(`Cron store written: ${this.storePath} (${jobs.length} jobs)`);
    return payload;
  }
}
