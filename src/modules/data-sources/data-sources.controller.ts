import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
} from '@nestjs/common';
import { DataSourcesService } from './data-sources.service';
import { SyncRecoveryService } from './sync-recovery.service';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';
import {
  CreateDataSourceDto,
  UpdateDataSourceDto,
} from './dto/data-source.dto';

@Controller('data-sources')
export class DataSourcesController {
  constructor(
    private readonly dataSourcesService: DataSourcesService,
    private readonly syncRecoveryService: SyncRecoveryService,
  ) {}

  @Get()
  async getAllDataSources() {
    return this.dataSourcesService.getAllDataSources();
  }

  @Get('sync-groups/status')
  getSyncGroupsStatus() {
    return this.dataSourcesService.getGroupsSyncProgress();
  }

  @Get(':id')
  async getDataSource(@Param('id') id: string) {
    return this.dataSourcesService.getDataSource(id);
  }

  @Post()
  @RequireWrite()
  async createDataSource(@Body() createDataSourceDto: CreateDataSourceDto) {
    return this.dataSourcesService.createDataSource(createDataSourceDto);
  }

  @Put(':id')
  @RequireWrite()
  async updateDataSource(
    @Param('id') id: string,
    @Body() updateDataSourceDto: UpdateDataSourceDto,
  ) {
    return this.dataSourcesService.updateDataSource(id, updateDataSourceDto);
  }

  @Delete(':id')
  @RequireWrite()
  async deleteDataSource(@Param('id') id: string) {
    return this.dataSourcesService.deleteDataSource(id);
  }

  @Post(':id/sync')
  @RequireWrite()
  async syncDataSource(@Param('id') id: string) {
    return this.dataSourcesService.syncDataSource(id);
  }

  @Post('sync-now')
  @RequireWrite()
  async syncNow() {
    return this.dataSourcesService.performSync();
  }

  @Post('recover')
  @RequireWrite()
  async recoverRansomware() {
    return this.syncRecoveryService.triggerRecovery();
  }

  @Post('sync-victims-by-country')
  @RequireWrite()
  async syncVictimsByCountry() {
    return this.dataSourcesService.syncVictimsByCountry();
  }

  @Post('sync-groups')
  @RequireWrite()
  async syncGroups() {
    return this.dataSourcesService.triggerGroupsSyncInBackground();
  }
}
