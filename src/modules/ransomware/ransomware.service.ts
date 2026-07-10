import { Injectable, Logger } from '@nestjs/common';
import { RansomwareApiClientService } from './api-client/api-client.service';
import { RansomwareDataProcessorService } from './data-processor/data-processor.service';
import { PrismaService } from '../../shared/database/prisma.service';
import { getAllCountries } from 'libs/utils/countries';

@Injectable()
export class RansomwareService {
  private readonly logger = new Logger(RansomwareService.name);

  constructor(
    private readonly apiClient: RansomwareApiClientService,
    private readonly dataProcessor: RansomwareDataProcessorService,
    private readonly prisma: PrismaService,
  ) {}

  private safeErrorMessage(error: any): string {
    if (typeof error === 'string') return error;
    if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED')
      return 'Connection timeout';
    if (error?.code === 'ENETUNREACH') return 'Network unreachable';
    if (error?.response?.status) return `HTTP ${error.response.status}`;
    return error?.message ? 'Operation failed' : 'Unknown error';
  }

  async getVictims() {
    const result = await this.apiClient.getVictims();

    if (result.success && result.data) {
      const victimsData = result.data.victims || result.data;
      if (Array.isArray(victimsData)) {
        const CHUNK_SIZE = 50;
        let totalProcessed = 0;

        for (let i = 0; i < victimsData.length; i += CHUNK_SIZE) {
          const chunk = victimsData.slice(i, i + CHUNK_SIZE);
          const processedChunk = chunk.map((victim) =>
            this.dataProcessor.processVictimData(victim),
          );
          await this.saveVictimsToDatabase(processedChunk);
          totalProcessed += processedChunk.length;
          processedChunk.length = 0;
        }

        victimsData.length = 0;

        return {
          success: true,
          data: [],
          count: totalProcessed,
          timestamp: new Date(),
        };
      } else {
        return {
          success: false,
          error: 'Victims data is not an array',
          timestamp: new Date(),
        };
      }
    }

    return result;
  }

  async getVictimsByCountry() {
    const countries = getAllCountries();
    const result = await this.apiClient.getVictimsByCountry(countries);

    if (result.success && result.data) {
      const CHUNK_SIZE = 50;
      let totalProcessed = 0;

      for (const countryData of result.data) {
        const countryVictims = countryData.victims || [];

        if (countryVictims.length > 0) {
          for (let i = 0; i < countryVictims.length; i += CHUNK_SIZE) {
            const chunk = countryVictims.slice(i, i + CHUNK_SIZE);
            const processedChunk = chunk.map((victim) =>
              this.dataProcessor.processVictimData(victim),
            );
            await this.saveVictimsToDatabase(processedChunk);
            totalProcessed += processedChunk.length;
            processedChunk.length = 0;
          }
        }

        if (countryData.victims) countryData.victims.length = 0;
      }

      result.data.length = 0;

      if (totalProcessed > 0) {
        return {
          success: true,
          data: [],
          count: totalProcessed,
          timestamp: new Date(),
        };
      } else {
        return {
          success: false,
          error: 'No victims found in any country',
          timestamp: new Date(),
        };
      }
    } else {
      return {
        success: false,
        error: result.error || 'Unknown error',
        timestamp: new Date(),
      };
    }
  }

  async getGroups() {
    const result = await this.apiClient.getGroups();

    if (result.success && result.data) {
      const groupsData = result.data.groups || result.data;

      if (Array.isArray(groupsData)) {
        const CHUNK_SIZE = 50;
        let totalProcessed = 0;

        for (let i = 0; i < groupsData.length; i += CHUNK_SIZE) {
          const chunk = groupsData.slice(i, i + CHUNK_SIZE);
          const processedChunk = chunk.map((group) =>
            this.dataProcessor.processGroupData(group),
          );
          await this.saveGroupsToDatabase(processedChunk);
          totalProcessed += processedChunk.length;
          processedChunk.length = 0;
        }

        groupsData.length = 0;

        return {
          success: true,
          data: [],
          count: totalProcessed,
          timestamp: new Date(),
        };
      } else {
        return {
          success: false,
          error: 'Groups data is not an array',
          timestamp: new Date(),
        };
      }
    }

    return result;
  }

  async syncGroupsData(options?: {
    onStart?: (total: number) => void;
    onProgress?: (update: {
      processed: number;
      successCount: number;
      errorCount: number;
    }) => void;
  }) {
    try {
      const groupsResult = await this.apiClient.getGroups();

      if (!groupsResult.success || !groupsResult.data) {
        return {
          success: false,
          error: 'Failed to fetch groups list',
          timestamp: new Date(),
        };
      }

      const groupsData = groupsResult.data.groups || groupsResult.data;

      if (!Array.isArray(groupsData) || groupsData.length === 0) {
        return {
          success: false,
          error: 'No groups found',
          timestamp: new Date(),
        };
      }

      const groupNames = groupsData
        .map((group) => {
          if (typeof group === 'string') return group;
          return group.group || group.name || group.title || '';
        })
        .filter((name) => name && name.trim().length > 0);

      if (groupNames.length === 0) {
        return {
          success: false,
          error: 'No valid group names found',
          timestamp: new Date(),
        };
      }

      const BATCH_SIZE = 3;
      const DELAY_MS = 1500;
      const totalGroups = groupNames.length;
      let successCount = 0;
      let errorCount = 0;
      let totalLocations = 0;

      options?.onStart?.(totalGroups);

      for (let i = 0; i < totalGroups; i += BATCH_SIZE) {
        const batch = groupNames.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (groupName) => {
            try {
              const response = await this.apiClient.Group(groupName);

              if (response.success && response.data) {
                const groupDataWithName = {
                  ...response.data,
                  group: response.data.group || response.data.name || groupName,
                };

                const processedGroup =
                  this.dataProcessor.processGroupData(groupDataWithName);

                if (
                  !processedGroup.group ||
                  processedGroup.group === 'Unknown Group'
                ) {
                  processedGroup.group = groupName;
                }

                const locationsCount = Array.isArray(processedGroup.locations)
                  ? processedGroup.locations.length
                  : 0;
                totalLocations += locationsCount;

                await this.saveSingleGroupToDatabase(processedGroup);
                successCount++;

                return { group: groupName, locationsCount };
              } else {
                errorCount++;
                const errorMsg = response.error || 'Unknown error';
                if (
                  errorMsg.includes('timeout') ||
                  errorMsg.includes('ETIMEDOUT')
                ) {
                  this.logger.warn(`${groupName}: Timeout`);
                } else if (errorMsg.includes('ENETUNREACH')) {
                  this.logger.warn(`${groupName}: Network unreachable`);
                } else {
                  this.logger.warn(
                    `${groupName}: ${this.safeErrorMessage(errorMsg)}`,
                  );
                }
                return null;
              }
            } catch (groupError: any) {
              errorCount++;
              this.logger.warn(
                `${groupName}: ${this.safeErrorMessage(groupError)}`,
              );
              return null;
            }
          }),
        );

        batchResults.length = 0;

        options?.onProgress?.({
          processed: successCount + errorCount,
          successCount,
          errorCount,
        });

        if (i + BATCH_SIZE < totalGroups) {
          await new Promise((resolve) => setTimeout(resolve, DELAY_MS));
        }
      }

      groupNames.length = 0;

      return {
        success: true,
        message: `Synced ${successCount} groups with ${totalLocations} total locations`,
        stats: { totalGroups, successCount, errorCount, totalLocations },
        timestamp: new Date(),
      };
    } catch (error: any) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(`Error syncing groups data: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async getGroupDetails(groupName: string) {
    try {
      const groupData = await this.prisma.ransomwareGroupsData.findUnique({
        where: { group: groupName },
      });

      if (!groupData) {
        return {
          success: false,
          error: `Grupo "${groupName}" no encontrado`,
          timestamp: new Date(),
        };
      }

      return { success: true, data: groupData, timestamp: new Date() };
    } catch (error: any) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(
        `Error fetching group details for ${groupName}: ${message}`,
      );
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async refreshGroupDetails(groupName: string) {
    try {
      if (!groupName || groupName.trim().length === 0) {
        return { success: false, error: 'Group name is required' };
      }

      const normalizedGroupName = groupName.trim();
      const response = await this.apiClient.Group(normalizedGroupName);

      if (!response.success || !response.data) {
        return {
          success: false,
          error: response.error || 'Failed to refresh group details',
          timestamp: new Date(),
        };
      }

      const groupDataWithName = {
        ...response.data,
        group: response.data.group || response.data.name || normalizedGroupName,
      };
      const processedGroup =
        this.dataProcessor.processGroupData(groupDataWithName);

      if (!processedGroup.group || processedGroup.group === 'Unknown Group') {
        processedGroup.group = normalizedGroupName;
      }

      const savedGroup = await this.saveSingleGroupToDatabase(processedGroup);

      return { success: true, data: savedGroup, timestamp: new Date() };
    } catch (error: any) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(
        `Error refreshing group details for ${groupName}: ${message}`,
      );
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async getAllGroupsWithDetails() {
    try {
      const groups = await this.prisma.ransomwareGroupsData.findMany({
        orderBy: { victims: 'desc' },
        select: {
          group: true,
          altname: true,
          victims: true,
          firstseen: true,
          lastseen: true,
          has_negotiations: true,
          negotiation_count: true,
          has_ransomnote: true,
          ransomnotes_count: true,
        },
      });

      return {
        success: true,
        data: groups,
        count: groups.length,
        timestamp: new Date(),
      };
    } catch (error: any) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(`Error fetching all groups: ${message}`);
      return {
        success: false,
        error: message,
        data: [],
        count: 0,
        timestamp: new Date(),
      };
    }
  }

  async getDashboardStats() {
    const [
      totalGroups,
      totalVictims,
      argentinaAttacks,
      groupsByVictims,
      victimsByCountry,
      victimsByMonth,
      victimsByActivity,
      recentActivity,
    ] = await Promise.all([
      this.getTotalGroups(),
      this.getTotalVictims(),
      this.getArgentinaAttacks(),
      this.getGroupsByVictims(),
      this.getVictimsByCountryStats(),
      this.getVictimsByMonth(),
      this.getVictimsByActivity(),
      this.getRecentActivity(),
    ]);

    const allGroups = await this.getAllGroups();

    return {
      success: true,
      data: {
        overview: { totalGroups, totalVictims, argentinaAttacks },
        topGroups: groupsByVictims.slice(0, 10),
        allGroups,
        attacksByCountry: victimsByCountry,
        monthlyTrend: victimsByMonth,
        sectorAnalysis: victimsByActivity.slice(0, 15),
        recentActivity: recentActivity.slice(0, 50),
      },
      timestamp: new Date(),
    };
  }

  async getVictimsByFilters(filters: { countryCode?: string; group?: string }) {
    const where: any = {};

    if (filters.countryCode) {
      where.country = filters.countryCode.trim().toUpperCase();
    }

    if (filters.group) {
      where.group = filters.group;
    }

    const victims = await this.prisma.ransomwareVictimsData.findMany({
      where,
      orderBy: { discovered: 'desc' },
      select: {
        id: true,
        victim: true,
        group: true,
        country: true,
        activity: true,
        discovered: true,
        website: true,
        description: true,
        postUrl: true,
        screenshot: true,
        permalink: true,
        attackDate: true,
        duplicates: true,
        extrainfos: true,
        infostealer: true,
        press: true,
        ransomwareLiveId: true,
      },
    });

    return {
      success: true,
      data: victims,
      count: victims.length,
      timestamp: new Date(),
    };
  }

  async getVictimsByCountryCode(countryCode: string) {
    const normalizedCode = countryCode.trim().toUpperCase();
    const victims = await this.prisma.ransomwareVictimsData.findMany({
      where: { country: normalizedCode },
      orderBy: { discovered: 'desc' },
      select: {
        id: true,
        victim: true,
        group: true,
        country: true,
        activity: true,
        discovered: true,
        website: true,
        description: true,
        postUrl: true,
        screenshot: true,
        permalink: true,
        attackDate: true,
        duplicates: true,
        extrainfos: true,
        infostealer: true,
        press: true,
        ransomwareLiveId: true,
      },
    });

    return {
      success: true,
      data: victims,
      count: victims.length,
      timestamp: new Date(),
    };
  }

  async syncData() {
    try {
      const [victimsResult, groupsResult] = await Promise.all([
        this.getVictims(),
        this.getGroups(),
      ]);

      const victimsCount =
        victimsResult.success && 'count' in victimsResult
          ? victimsResult.count
          : 0;
      const groupsCount =
        groupsResult.success && 'count' in groupsResult
          ? groupsResult.count
          : 0;

      const result = {
        success: true,
        data: { victims: [], groups: [] },
        stats: { victimsCount, groupsCount },
        timestamp: new Date(),
      };

      if (
        victimsResult.success &&
        'data' in victimsResult &&
        Array.isArray(victimsResult.data)
      ) {
        victimsResult.data.length = 0;
      }
      if (
        groupsResult.success &&
        'data' in groupsResult &&
        Array.isArray(groupsResult.data)
      ) {
        groupsResult.data.length = 0;
      }

      return result;
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(`Error syncing ransomware data: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  private async getAllGroups(): Promise<string[]> {
    const groups = await this.prisma.ransomwareVictimsData.findMany({
      select: { group: true },
      distinct: ['group'],
      orderBy: { group: 'asc' },
    });
    return groups.map((g) => g.group).filter(Boolean);
  }

  private async getTotalGroups() {
    return this.prisma.ransomwareGroupsData.count();
  }
  private async getTotalVictims() {
    return this.prisma.ransomwareVictimsData.count();
  }
  private async getArgentinaAttacks() {
    return this.prisma.ransomwareVictimsData.count({
      where: { country: 'AR' },
    });
  }

  private async getGroupsByVictims() {
    return this.prisma.ransomwareGroupsData.findMany({
      orderBy: { victims: 'desc' },
      select: { group: true, altname: true, victims: true },
    });
  }

  private async getVictimsByCountryStats() {
    const countryStats = await this.prisma.ransomwareVictimsData.groupBy({
      by: ['country'],
      _count: { country: true },
      where: { country: { not: null } },
      orderBy: { _count: { country: 'desc' } },
    });

    const normalizedStats = countryStats
      .map((stat) => ({
        country: stat.country ? stat.country.trim().toUpperCase() : null,
        count: stat._count.country,
      }))
      .filter(
        (stat): stat is { country: string; count: number } =>
          stat.country !== null && stat.country.length === 2,
      );

    const groupedStats = normalizedStats.reduce(
      (acc, stat) => {
        const existing = acc.find((s) => s.country === stat.country);
        if (existing) {
          existing.count += stat.count;
        } else {
          acc.push({ country: stat.country, count: stat.count });
        }
        return acc;
      },
      [] as Array<{ country: string; count: number }>,
    );

    groupedStats.sort((a, b) => b.count - a.count);
    return groupedStats;
  }

  private async getVictimsByMonth() {
    const twelveMonthsAgo = new Date();
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);

    const victims = await this.prisma.ransomwareVictimsData.findMany({
      where: { discovered: { gte: twelveMonthsAgo } },
      select: { discovered: true },
      orderBy: { discovered: 'asc' },
    });

    const monthlyMap = new Map<string, number>();
    victims.forEach((victim) => {
      const month = victim.discovered.toISOString().substring(0, 7);
      monthlyMap.set(month, (monthlyMap.get(month) || 0) + 1);
    });

    return Array.from(monthlyMap.entries())
      .map(([month, count]) => ({ month, count }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }

  private async getVictimsByActivity() {
    const activityStats = await this.prisma.ransomwareVictimsData.groupBy({
      by: ['activity'],
      _count: { activity: true },
      where: { AND: [{ activity: { not: null } }, { activity: { not: '' } }] },
      orderBy: { _count: { activity: 'desc' } },
    });
    return activityStats.map((stat) => ({
      activity: stat.activity,
      count: stat._count.activity,
    }));
  }

  private async getRecentActivity() {
    return this.prisma.ransomwareVictimsData.findMany({
      orderBy: { discovered: 'desc' },
      take: 50,
      select: {
        id: true,
        victim: true,
        group: true,
        country: true,
        activity: true,
        discovered: true,
        website: true,
        description: true,
        postUrl: true,
        screenshot: true,
        permalink: true,
        attackDate: true,
        duplicates: true,
        extrainfos: true,
        infostealer: true,
        press: true,
        ransomwareLiveId: true,
      },
    });
  }

  private async saveVictimsToDatabase(victims: any[]) {
    try {
      for (const victim of victims) {
        await this.prisma.ransomwareVictimsData.upsert({
          where: { ransomwareLiveId: victim.ransomwareLiveId },
          update: victim,
          create: victim,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error saving ransomware victims: ${this.safeErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async saveGroupsToDatabase(groups: any[]) {
    try {
      for (const group of groups) {
        const normalizedGroupName =
          typeof group?.group === 'string' && group.group.trim().length > 0
            ? group.group.trim()
            : `unknown-group-${group.id}`;

        const groupRecord = {
          group: normalizedGroupName,
          altname:
            typeof group?.altname === 'string' &&
            group.altname.trim().length > 0
              ? group.altname.trim()
              : 'N/A',
          victims:
            typeof group?.victims === 'number' && Number.isFinite(group.victims)
              ? group.victims
              : 0,
        };

        await this.prisma.ransomwareGroupsData.upsert({
          where: { group: groupRecord.group },
          update: {
            altname: groupRecord.altname,
            victims: groupRecord.victims,
          },
          create: groupRecord,
        });
      }
    } catch (error) {
      this.logger.error(
        `Error saving ransomware groups: ${this.safeErrorMessage(error)}`,
      );
      throw error;
    }
  }

  private async saveSingleGroupToDatabase(groupData: any) {
    try {
      if (!groupData.group || groupData.group.trim().length === 0) {
        throw new Error('Group name is required');
      }

      return this.prisma.ransomwareGroupsData.upsert({
        where: { group: groupData.group },
        update: {
          altname: groupData.altname,
          description: groupData.description,
          victims: groupData.victims,
          firstseen: groupData.firstseen,
          lastseen: groupData.lastseen,
          added_date: groupData.added_date,
          has_negotiations: groupData.has_negotiations,
          negotiation_count: groupData.negotiation_count,
          has_ransomnote: groupData.has_ransomnote,
          ransomnotes_count: groupData.ransomnotes_count,
          url: groupData.url,
          ttps: groupData.ttps,
          vulnerabilities: groupData.vulnerabilities,
          tools: groupData.tools,
          locations: groupData.locations,
        },
        create: groupData,
      });
    } catch (error: any) {
      this.logger.error(
        `Error saving ransomware group ${groupData.group}: ${this.safeErrorMessage(error)}`,
      );
      throw error;
    }
  }
}
