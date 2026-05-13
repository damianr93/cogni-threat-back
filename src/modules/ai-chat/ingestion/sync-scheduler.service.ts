import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { IngestionService } from './ingestion.service';

@Injectable()
export class SyncSchedulerService {
  private readonly logger = new Logger(SyncSchedulerService.name);

  constructor(private readonly ingestion: IngestionService) {}

  @Cron('0 */30 * * * *')
  async syncAll(): Promise<void> {
    this.logger.log('Cron: iniciando sincronización incremental de vectores');
    await this.ingestion.ingestAll();
  }

  async triggerFull(): Promise<void> {
    this.logger.log('Trigger manual: iniciando ingesta completa');
    await this.ingestion.ingestAll();
  }
}
