import { Module } from '@nestjs/common';
import { DataSourcesController } from './data-sources.controller';
import { DataSourcesService } from './data-sources.service';
import { SyncRecoveryService } from './sync-recovery.service';
import { GroupsSyncProgressService } from './groups-sync-progress.service';
import { DatabaseModule } from '../../shared/database/database.module';
import { RansomwareModule } from '../ransomware/ransomware.module';

@Module({
  imports: [DatabaseModule, RansomwareModule],
  controllers: [DataSourcesController],
  providers: [
    DataSourcesService,
    SyncRecoveryService,
    GroupsSyncProgressService,
  ],
})
export class DataSourcesModule {}
