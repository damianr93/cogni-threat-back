import { Controller, Get, Query } from '@nestjs/common';
import { DashboardService } from './dashboard.service';
import { ThreatDataDto } from '../../shared/dto/threat-data.dto';

@Controller('dashboard')
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('threat-data')
  async getThreatData(@Query() query: ThreatDataDto) {
    return this.dashboardService.getThreatData(query);
  }

  @Get('stats')
  async getStats() {
    return this.dashboardService.getStats();
  }

  @Get('sources')
  async getActiveSources() {
    return this.dashboardService.getActiveSources();
  }

  @Get('ransomware-stats')
  async getRansomwareStats() {
    return this.dashboardService.getRansomwareStats();
  }

  @Get('victims-by-country')
  async getVictimsByCountry(@Query('countryCode') countryCode: string) {
    return this.dashboardService.getVictimsByCountryCode(countryCode);
  }

  @Get('victims-by-filters')
  async getVictimsByFilters(
    @Query('countryCode') countryCode?: string,
    @Query('group') group?: string,
  ) {
    return this.dashboardService.getVictimsByFilters({ countryCode, group });
  }

  @Get('group-details')
  async getGroupDetails(@Query('groupName') groupName: string) {
    return this.dashboardService.getGroupDetails(groupName);
  }

  @Get('all-groups')
  async getAllGroupsWithDetails() {
    return this.dashboardService.getAllGroupsWithDetails();
  }
}
