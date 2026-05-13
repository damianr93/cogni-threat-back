import { Module } from '@nestjs/common';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';
import { AlertProcessorService } from './alert-processor.service';
import { TelegramService } from './telegram.service';
import { TelegramChannelService } from './telegram-channel.service';
import { DatabaseModule } from '../../shared/database/database.module';
import { VulnWatchProfilesService } from './vuln/vuln-watch-profiles.service';
import { VulnAlertPreviewService } from './vuln/vuln-alert-preview.service';
import { VulnWatchProfilesController } from './vuln/vuln-watch-profiles.controller';

@Module({
  imports: [DatabaseModule],
  controllers: [AlertsController, VulnWatchProfilesController],
  providers: [
    AlertsService,
    AlertProcessorService,
    TelegramService,
    TelegramChannelService,
    VulnWatchProfilesService,
    VulnAlertPreviewService,
  ],
  exports: [TelegramChannelService, VulnWatchProfilesService],
})
export class AlertsModule {}
