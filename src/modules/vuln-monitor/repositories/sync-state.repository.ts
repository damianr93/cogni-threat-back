import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';

export type VulnSource = 'nvd' | 'kev' | 'github' | 'osv' | 'epss';
const ALL_SOURCES: VulnSource[] = ['nvd', 'kev', 'github', 'osv', 'epss'];

@Injectable()
export class SyncStateRepository {
  constructor(private readonly prisma: PrismaService) {}

  async seed() {
    await Promise.all(
      ALL_SOURCES.map((source) =>
        this.prisma.vulnSyncState.upsert({
          where: { source },
          update: {},
          create: { source },
        }),
      ),
    );
  }

  async getLastSync(source: VulnSource) {
    const row = await this.prisma.vulnSyncState.findUnique({ where: { source } });
    return row?.lastSyncAt ?? null;
  }

  async getCursor(source: VulnSource) {
    const row = await this.prisma.vulnSyncState.findUnique({ where: { source } });
    return row?.lastCursor ?? null;
  }

  async markProgress(source: VulnSource, watermark: Date, cursor?: string) {
    await this.prisma.vulnSyncState.update({
      where: { source },
      data: {
        lastSyncAt: watermark,
        lastCursor: cursor ?? undefined,
      },
    });
  }

  async markSuccess(source: VulnSource, count: number, cursor?: string, watermark?: Date) {
    await this.prisma.vulnSyncState.update({
      where: { source },
      data: {
        lastSyncAt: watermark ?? new Date(),
        lastCount: count,
        lastCursor: cursor ?? null,
        lastError: null,
      },
    });
  }

  async markError(source: VulnSource, error: string) {
    await this.prisma.vulnSyncState.update({
      where: { source },
      data: {
        lastError: error.slice(0, 500),
        errorCount: { increment: 1 },
      },
    });
  }

  async getAll() {
    return this.prisma.vulnSyncState.findMany();
  }
}
