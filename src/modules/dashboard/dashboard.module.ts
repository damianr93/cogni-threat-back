import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { DatabaseModule } from '../../shared/database/database.module';
import { RansomwareModule } from '../ransomware/ransomware.module';

@Module({
  imports: [DatabaseModule, RansomwareModule],
  controllers: [DashboardController],
  providers: [DashboardService],
})
export class DashboardModule {}
