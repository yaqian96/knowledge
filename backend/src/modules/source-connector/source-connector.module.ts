import { Module } from '@nestjs/common';
import { IngestModule } from '../ingest/ingest.module';
import { ConnectorRegistry } from './connector.registry';
import { CredentialService } from './credential.service';
import { SyncOrchestratorService } from './sync-orchestrator.service';
import { SyncCronScheduler } from '../scheduler/sync-cron.scheduler';
import { SyncCronStore } from '../scheduler/sync-cron.store';
import { SourceController } from './source.controller';
import { YoudaoCookieConnector } from './providers/youdao/youdao-cookie.connector';
import { YnoteContentParser } from './providers/youdao/ynote-content.parser';

@Module({
  imports: [IngestModule],
  controllers: [SourceController],
  providers: [
    CredentialService,
    ConnectorRegistry,
    SyncOrchestratorService,
    SyncCronStore,
    SyncCronScheduler,
    YoudaoCookieConnector,
    YnoteContentParser,
  ],
  exports: [ConnectorRegistry, SyncOrchestratorService],
})
export class SourceConnectorModule {}
