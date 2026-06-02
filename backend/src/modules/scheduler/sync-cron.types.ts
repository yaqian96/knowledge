export interface SyncCronJobDef {
  id: string;
  userId: string;
  provider: string;
  enabled: boolean;
  cronExpr: string;
  timezone: string;
  lastSyncAt?: string | null;
}

export interface SyncCronStoreFile {
  version: 1;
  updatedAt: string;
  jobs: SyncCronJobDef[];
}

export interface SourceSyncJobPayload {
  syncJobId: string;
  userId: string;
  provider: string;
  trigger: 'cron' | 'startup' | 'manual';
}

export const SOURCE_SYNC_QUEUE = 'source-sync';
