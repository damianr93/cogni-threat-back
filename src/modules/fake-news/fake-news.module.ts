import { Module } from '@nestjs/common';
import { FakeNewsController } from './fake-news.controller';
import { FakeNewsService } from './fake-news.service';
import { DatabaseModule } from '../../shared/database/database.module';

@Module({
  imports: [DatabaseModule],
  controllers: [FakeNewsController],
  providers: [FakeNewsService],
})
export class FakeNewsModule {}

