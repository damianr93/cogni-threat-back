import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../shared/database/database.module';
import { RiskOperationsController } from './risk-operations.controller';
import { RiskOperationsService } from './risk-operations.service';

@Module({
  imports: [DatabaseModule],
  controllers: [RiskOperationsController],
  providers: [RiskOperationsService],
})
export class RiskOperationsModule {}
