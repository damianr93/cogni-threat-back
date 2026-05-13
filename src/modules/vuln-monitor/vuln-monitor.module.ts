import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { DatabaseModule } from '../../shared/database/database.module';
import { VulnMonitorController } from './vuln-monitor.controller';
import { VulnMonitorService } from './vuln-monitor.service';
import { SyncSchedulerService } from './services/sync-scheduler.service';
import { KevCollector } from './collectors/kev.collector';
import { NvdCollector } from './collectors/nvd.collector';
import { GithubAdvisoryCollector } from './collectors/github-advisory.collector';
import { OsvCollector } from './collectors/osv.collector';
import { EpssCollector } from './collectors/epss.collector';
import { VulnCveRepository } from './repositories/vuln-cve.repository';
import { SyncStateRepository } from './repositories/sync-state.repository';

@Module({
  imports: [HttpModule, DatabaseModule],
  controllers: [VulnMonitorController],
  providers: [
    VulnMonitorService,
    SyncSchedulerService,
    KevCollector,
    NvdCollector,
    GithubAdvisoryCollector,
    OsvCollector,
    EpssCollector,
    VulnCveRepository,
    SyncStateRepository,
  ],
})
export class VulnMonitorModule {}
