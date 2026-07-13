import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IngestionService } from './ingestion.service';
import { EmbeddingSyncControlService } from './embedding-sync-control.service';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(
    private readonly ingestion: IngestionService,
    private readonly embeddingSyncControl: EmbeddingSyncControlService,
  ) {}

  @Cron('0 */30 * * * *')
  async syncAll(): Promise<void> {
    if (this.embeddingSyncControl.getStatus().manualPaused) {
      this.logger.log('Cron: sincronización de vectores pausada manualmente');
      return;
    }

    this.logger.log('Cron: iniciando sincronización incremental de vectores');
    await this.ingestion.ingestAll();
  }

  async triggerFull(): Promise<void> {
    this.logger.log('Trigger manual: iniciando ingesta completa');
    await this.ingestion.ingestAll();
  }

  pauseEmbeddingSync() {
    return this.embeddingSyncControl.pauseManual();
  }

  resumeEmbeddingSync() {
    return this.embeddingSyncControl.resumeManual();
  }

  getEmbeddingSyncStatus() {
    return this.embeddingSyncControl.getStatus();
  }
}
