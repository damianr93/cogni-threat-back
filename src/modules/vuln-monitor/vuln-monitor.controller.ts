import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  Body,
  NotFoundException,
} from '@nestjs/common';
import { VulnMonitorService } from './vuln-monitor.service';
import { SyncSchedulerService } from './services/sync-scheduler.service';
import { CveQueryDto } from './dto/cve-query.dto';
import { SyncBackfillDto } from './dto/sync-backfill.dto';
import { RequireWrite } from '../../shared/auth/decorators/require-write.decorator';

@Controller()
export class VulnMonitorController {
  constructor(
    private readonly vulnMonitor: VulnMonitorService,
    private readonly scheduler: SyncSchedulerService,
  ) {}

  @Get('cves')
  async getCves(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('severity') severity?: string,
    @Query('source') source?: string,
    @Query('is_kev') is_kev?: string,
    @Query('search') search?: string,
    @Query('sort') sort?: string,
    @Query('order') order?: string,
    @Query('since') since?: string,
  ) {
    const query: CveQueryDto = {
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
      severity,
      source,
      is_kev: is_kev !== undefined ? is_kev === 'true' : undefined,
      search,
      sort: sort as CveQueryDto['sort'],
      order: order as CveQueryDto['order'],
      since,
    };
    return this.vulnMonitor.getCves(query);
  }

  @Get('cves/stats')
  async getStats() {
    return this.vulnMonitor.getStats();
  }

  @Get('cves/:id')
  async getCveById(@Param('id') id: string) {
    const cve = await this.vulnMonitor.getCveById(id);
    if (!cve) throw new NotFoundException(`CVE ${id} not found`);
    return cve;
  }

  @Get('sync/status')
  async getSyncStatus() {
    return this.vulnMonitor.getSyncStatus();
  }

  @Post('sync/trigger')
  @RequireWrite()
  async triggerSync() {
    return this.scheduler.triggerManualSync();
  }

  @Post('sync/backfill')
  @RequireWrite()
  async triggerBackfill(@Body() body: SyncBackfillDto) {
    return this.scheduler.triggerBackfill(body);
  }

  @Post('sync/epss')
  @RequireWrite()
  async triggerEpss() {
    return this.scheduler.triggerEpssSync();
  }
}
