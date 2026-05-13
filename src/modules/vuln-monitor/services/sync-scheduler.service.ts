import { Injectable, Logger, forwardRef, Inject } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { KevCollector } from '../collectors/kev.collector';
import { NvdCollector } from '../collectors/nvd.collector';
import { GithubAdvisoryCollector } from '../collectors/github-advisory.collector';
import { OsvCollector } from '../collectors/osv.collector';
import { EpssCollector } from '../collectors/epss.collector';
import { VulnMonitorService } from '../vuln-monitor.service';
import { parseBackfillDates } from '../dto/sync-backfill.dto';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    private readonly kev: KevCollector,
    private readonly nvd: NvdCollector,
    private readonly github: GithubAdvisoryCollector,
    private readonly osv: OsvCollector,
    private readonly epss: EpssCollector,
    @Inject(forwardRef(() => VulnMonitorService))
    private readonly vulnMonitor: VulnMonitorService,
  ) {}

  // Every 30 minutes — realtime sources
  @Cron('*/30 * * * *')
  async syncRealtime() {
    this.logger.log('Starting realtime vuln sync...');
    const results = await Promise.allSettled([
      this.kev.sync(),
      this.nvd.sync(),
      this.github.sync(),
      this.osv.sync(),
    ]);

    for (const result of results) {
      if (result.status === 'rejected') {
        this.logger.error('Collector crashed:', result.reason);
      }
    }
    this.logger.log('Realtime sync complete');
  }

  // EPSS once daily at 08:00 AM Argentina (UTC-3 = 11:00 UTC)
  @Cron('0 11 * * *')
  async syncEpss() {
    this.logger.log('Starting EPSS daily sync...');
    await this.epss.sync();
  }

  async triggerManualSync() {
    this.logger.log('Manual vuln sync triggered');
    // Fire-and-forget — collectors run in background, response is immediate
    Promise.allSettled([
      this.kev.sync(),
      this.nvd.sync(),
      this.github.sync(),
      this.osv.sync({ maxItems: 500 }),
    ]).then((results) => {
      for (const r of results) {
        if (r.status === 'rejected') this.logger.error('Collector crashed:', r.reason);
      }
      this.vulnMonitor.invalidateStatsCache();
      this.logger.log('Manual sync finished');
    });
    return { started: true, message: 'Sync iniciado en background. Consultá /sync/status para el estado.' };
  }

  async triggerEpssSync() {
    return this.epss.sync();
  }

  async triggerBackfill(dto: { source: string; since: string; until?: string }) {
    const { since, until } = parseBackfillDates(dto as Parameters<typeof parseBackfillDates>[0]);
    this.logger.log(`Backfill triggered for ${dto.source} since ${since.toISOString()}`);

    const run = async () => {
      switch (dto.source) {
        case 'nvd':
          await this.nvd.sync(since, until);
          break;
        case 'github':
          await this.github.sync(since);
          break;
        case 'osv':
          await this.osv.sync(since);
          break;
        case 'kev':
          await this.kev.sync();
          break;
        default:
          throw new Error(`Unsupported backfill source: ${dto.source}`);
      }
      this.vulnMonitor.invalidateStatsCache();
      this.logger.log(`Backfill finished for ${dto.source}`);
    };

    void run().catch((err) => this.logger.error(`Backfill failed for ${dto.source}:`, err));

    return {
      started: true,
      source: dto.source,
      since: since.toISOString(),
      until: until.toISOString(),
      message: 'Backfill iniciado en background. Consultá /sync/status para el estado.',
    };
  }
}
