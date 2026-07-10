import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/database/prisma.service';
import { ThreatDataDto } from '../../shared/dto/threat-data.dto';
import { RansomwareService } from '../ransomware/ransomware.service';

@Injectable()
export class DashboardService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly ransomwareService: RansomwareService,
  ) {}

  async getThreatData(query: ThreatDataDto) {
    const { limit = 50, offset = 0, severity, category, sourceId } = query;

    const where: any = {};
    if (severity) where.severity = severity;
    if (category) where.category = category;
    if (sourceId) where.sourceId = sourceId;

    const [data, total] = await Promise.all([
      this.prisma.threatData.findMany({
        where,
        include: { source: true },
        orderBy: { publishedAt: 'desc' },
        take: limit,
        skip: offset,
      }),
      this.prisma.threatData.count({ where }),
    ]);

    return { data, total, limit, offset };
  }

  async getStats() {
    const [total, bySeverity, byCategory] = await Promise.all([
      this.prisma.threatData.count(),
      this.prisma.threatData.groupBy({ by: ['severity'], _count: true }),
      this.prisma.threatData.groupBy({ by: ['category'], _count: true }),
    ]);

    return { total, bySeverity, byCategory };
  }

  async getActiveSources() {
    return this.prisma.dataSource.findMany({
      where: { isActive: true },
      select: { id: true, name: true, type: true, lastSync: true },
    });
  }

  async getRansomwareStats() {
    return this.ransomwareService.getDashboardStats();
  }

  async getVictimsByCountryCode(countryCode: string) {
    if (!countryCode) {
      return {
        success: false,
        error: 'Country code is required',
        data: [],
        count: 0,
      };
    }
    return this.ransomwareService.getVictimsByCountryCode(countryCode);
  }

  async getVictimsByFilters(filters: { countryCode?: string; group?: string }) {
    return this.ransomwareService.getVictimsByFilters(filters);
  }

  async getGroupDetails(groupName: string) {
    if (!groupName) {
      return { success: false, error: 'Group name is required' };
    }
    return this.ransomwareService.getGroupDetails(groupName);
  }

  async getAllGroupsWithDetails() {
    return this.ransomwareService.getAllGroupsWithDetails();
  }
}
