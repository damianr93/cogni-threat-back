import { Module } from '@nestjs/common';
import { CountriesController } from './countries.controller';
import { CountriesService } from './countries.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { SharedModule } from '../../shared/shared.module';

@Module({
  imports: [SharedModule],
  controllers: [CountriesController],
  providers: [CountriesService, PrismaService],
})
export class CountriesModule {}