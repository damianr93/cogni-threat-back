import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../../shared/database/prisma.service';
import { RansomwareService } from '../ransomware/ransomware.service';
import { GroupsSyncProgressService } from './groups-sync-progress.service';

@Injectable()
export class DataSourcesService {
  private readonly logger = new Logger(DataSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ransomwareService: RansomwareService,
    private readonly groupsSyncProgress: GroupsSyncProgressService,
  ) {}

  private safeErrorMessage(error: any): string {
    if (typeof error === 'string') return error;
    if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') return 'Connection timeout';
    if (error?.code === 'ENETUNREACH') return 'Network unreachable';
    if (error?.response?.status) return `HTTP ${error.response.status}`;
    return error?.message ? 'Operation failed' : 'Unknown error';
  }

  @Cron('0 */30 * * * *')
  async syncRansomwareData() {
    return this.performSync();
  }

  @Cron('0 0 * * *')
  async syncRansomwareNightly() {
    const groupsResult = await this.syncGroups();
    if (groupsResult.success) {
      this.logger.log(`Ransomware groups full sync completed: ${groupsResult.message}`);
    } else {
      this.logger.warn(`Ransomware groups full sync failed: ${this.safeErrorMessage(groupsResult.error)}`);
    }

    const victimsResult = await this.syncVictimsByCountry();
    if (victimsResult.success) {
      this.logger.log(`Ransomware victims by country sync completed: ${victimsResult.message}`);
    } else {
      this.logger.warn(`Ransomware victims by country sync failed: ${this.safeErrorMessage(victimsResult.error)}`);
    }

    return { groups: groupsResult, victims: victimsResult };
  }

  async performSync() {
    try {
      const result = await this.ransomwareService.syncData() as any;
      if (result.success) {
        const dataSource = await this.prisma.dataSource.findFirst({
          where: { name: 'ransomware-live' },
        });

        if (dataSource) {
          await this.prisma.dataSource.update({
            where: { id: dataSource.id },
            data: { lastSync: new Date() },
          });

          const stats = result.stats || {};

          return {
            success: true,
            message: 'Data sync completed successfully',
            timestamp: new Date(),
            dataCount: {
              victims: stats.victimsCount || 0,
              groups: stats.groupsCount || 0,
            },
          };
        } else {
          await this.prisma.dataSource.create({
            data: {
              name: 'ransomware-live',
              type: 'api',
              endpoint: 'https://api.ransomware.live',
              isActive: true,
            },
          });

          return {
            success: true,
            message: 'Data source created, sync will be available on next run',
            timestamp: new Date(),
          };
        }
      } else {
        const message = this.safeErrorMessage(result.error);
        this.logger.warn(`Ransomware data sync failed: ${message}`);
        return { success: false, error: message, timestamp: new Date() };
      }
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(`Error during ransomware data sync: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async getAllDataSources() {
    return this.prisma.dataSource.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getDataSource(id: string) {
    const dataSource = await this.prisma.dataSource.findUnique({ where: { id } });
    if (!dataSource) throw new NotFoundException(`Data source with ID ${id} not found`);
    return dataSource;
  }

  async createDataSource(createDataSourceDto: any) {
    return this.prisma.dataSource.create({ data: createDataSourceDto });
  }

  async updateDataSource(id: string, updateDataSourceDto: any) {
    await this.getDataSource(id);
    return this.prisma.dataSource.update({ where: { id }, data: updateDataSourceDto });
  }

  async deleteDataSource(id: string) {
    await this.getDataSource(id);
    return this.prisma.dataSource.delete({ where: { id } });
  }

  async syncDataSource(id: string) {
    const dataSource = await this.getDataSource(id);

    try {
      if (dataSource.name === 'ransomware-live') {
        await this.ransomwareService.syncData();
      }

      return this.prisma.dataSource.update({ where: { id }, data: { lastSync: new Date() } });
    } catch (error) {
      throw new Error(`Error syncing data source: ${this.safeErrorMessage(error)}`);
    }
  }

  async syncVictimsByCountry() {
    try {
      const result = await this.ransomwareService.getVictimsByCountry();

      if (result.success) {
        const dataSource = await this.prisma.dataSource.findFirst({ where: { name: 'ransomware-live' } });

        if (dataSource) {
          await this.prisma.dataSource.update({ where: { id: dataSource.id }, data: { lastSync: new Date() } });

          return {
            success: true,
            message: 'Victims by country sync completed successfully',
            timestamp: new Date(),
            dataCount: 'count' in result ? result.count : 0,
          };
        }
      }

      return { success: false, error: result.error || 'Unknown error', timestamp: new Date() };
    } catch (error) {
      const message = this.safeErrorMessage(error);
      this.logger.warn(`Error during victims by country sync: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async syncGroups() {
    return this.executeGroupsSync();
  }

  triggerGroupsSyncInBackground(): { started: boolean; message: string } {
    if (this.groupsSyncProgress.isRunning()) {
      return { started: false, message: 'Ya hay una sincronización de grupos en curso' };
    }

    this.groupsSyncProgress.start(0);
    void this.executeGroupsSync(true)
      .catch((error: Error) => {
        const message = this.safeErrorMessage(error);
        this.logger.error(`Groups background sync failed: ${message}`);
        this.groupsSyncProgress.fail(message);
      });

    return { started: true, message: 'Sincronización de grupos iniciada' };
  }

  getGroupsSyncProgress() {
    return this.groupsSyncProgress.getStatus();
  }

  private async executeGroupsSync(trackProgress = false) {
    try {
      const result = await this.ransomwareService.syncGroupsData(
        trackProgress
          ? {
              onStart: (total) => this.groupsSyncProgress.start(total),
              onProgress: (update) => this.groupsSyncProgress.update(update),
            }
          : undefined,
      );

      if (result && result.success) {
        const dataSource = await this.prisma.dataSource.findFirst({ where: { name: 'ransomware-live' } });

        if (dataSource) {
          await this.prisma.dataSource.update({ where: { id: dataSource.id }, data: { lastSync: new Date() } });

          if (trackProgress) {
            this.groupsSyncProgress.complete(result.message || 'Groups sync completed successfully');
          }

          return {
            success: true,
            message: result.message || 'Groups sync completed successfully',
            timestamp: new Date(),
            stats: result.stats || {},
          };
        }
      }

      if (trackProgress) {
        this.groupsSyncProgress.fail(result?.error || 'Unknown error');
      }

      return { success: false, error: result?.error || 'Unknown error', timestamp: new Date() };
    } catch (error: any) {
      const message = this.safeErrorMessage(error);
      this.logger.error(`Error during groups sync: ${message}`);
      if (trackProgress) {
        this.groupsSyncProgress.fail(message);
      }
      return { success: false, error: message, timestamp: new Date() };
    }
  }
}
