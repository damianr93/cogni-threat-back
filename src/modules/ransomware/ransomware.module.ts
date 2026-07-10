import { Module } from '@nestjs/common';
import { HttpModule } from '@nestjs/axios';
import { RansomwareService } from './ransomware.service';
import { RansomwareApiClientService } from './api-client/api-client.service';
import { RansomwareDataProcessorService } from './data-processor/data-processor.service';
import { DatabaseModule } from '../../shared/database/database.module';

@Module({
  imports: [
    HttpModule.register({ timeout: 60000, maxRedirects: 5 }),
    DatabaseModule,
  ],
  providers: [
    RansomwareService,
    RansomwareApiClientService,
    RansomwareDataProcessorService,
  ],
  exports: [RansomwareService],
})
export class RansomwareModule {}
