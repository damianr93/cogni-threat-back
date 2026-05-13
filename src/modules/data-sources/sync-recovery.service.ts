import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { envs } from 'libs/config/src/envs';
import { PrismaService } from '../../shared/database/prisma.service';
import { DataSourcesService } from './data-sources.service';

export interface SyncRecoveryConfig {
  onBoot: boolean;
  staleHours: number;
}

@Injectable()
export class SyncRecoveryService implements OnModuleInit {
  private readonly logger = new Logger(SyncRecoveryService.name);
  private readonly config: SyncRecoveryConfig;

  constructor(
    private readonly prisma: PrismaService,
    private readonly dataSources: DataSourcesService,
    @Optional() config?: SyncRecoveryConfig,
  ) {
    this.config = config ?? {
      onBoot: envs.RANSOMWARE_RECOVERY_ON_BOOT,
      staleHours: envs.RANSOMWARE_RECOVERY_STALE_HOURS,
    };
  }

  async onModuleInit() {
    if (!this.config.onBoot) return;
    const dataSource = await this.prisma.dataSource.findFirst({
      where: { name: 'ransomware-live' },
    });
    if (!this.isStale(dataSource?.lastSync ?? null)) return;
    this.logger.warn(
      `Ransomware sync stale (last: ${dataSource?.lastSync?.toISOString() ?? 'never'}) — scheduling full recovery`,
    );
    void this.runFullRecovery();
  }

  isStale(lastSync: Date | null): boolean {
    if (!lastSync) return true;
    const ageMs = Date.now() - lastSync.getTime();
    return ageMs > this.config.staleHours * 60 * 60 * 1000;
  }

  async triggerRecovery() {
    void this.runFullRecovery();
    return {
      started: true,
      message: 'Ransomware full recovery started in background',
    };
  }

  private async runFullRecovery() {
    try {
      await this.dataSources.syncGroups();
      await this.dataSources.syncVictimsByCountry();
      this.logger.log('Ransomware full recovery completed');
    } catch (err: any) {
      this.logger.error(`Ransomware full recovery failed: ${err.message}`);
    }
  }
}
