import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { VulnCveRepository } from './repositories/vuln-cve.repository';
import { SyncStateRepository } from './repositories/sync-state.repository';
import { CveQueryDto } from './dto/cve-query.dto';
import { CveListItemDto, CveResponseDto } from './dto/cve-response.dto';

interface DbStatsCache {
  total: number;
  kevCount: number;
  newLast24h: number;
  bySeverity: Record<string, number>;
}

@Injectable()
export class VulnMonitorService implements OnModuleInit {
  private readonly logger = new Logger(VulnMonitorService.name);
  private statsCache: { data: DbStatsCache; expiresAt: number } | null = null;
  private readonly STATS_TTL_MS = 60_000;

  constructor(
    private readonly cveRepo: VulnCveRepository,
    private readonly syncState: SyncStateRepository,
  ) {}

  async onModuleInit() {
    try {
      await this.syncState.seed();
      this.logger.log('VulnSyncState rows seeded');
    } catch (err: any) {
      this.logger.error('Failed to seed VulnSyncState:', err.message);
    }
  }

  async getCves(query: CveQueryDto) {
    const hasFilters = this.hasListFilters(query);
    let cachedTotal: number | undefined;

    if (!hasFilters) {
      const dbStats = await this.getDbStats();
      cachedTotal = dbStats.total;
    }

    const result = await this.cveRepo.findMany(query, { cachedTotal });
    return {
      ...result,
      data: result.data.map((cve) => this.mapCveListItem(cve)),
    };
  }

  invalidateStatsCache() {
    this.statsCache = null;
  }

  async getCveById(id: string): Promise<CveResponseDto | null> {
    const cve = await this.cveRepo.findById(id);
    return cve ? this.mapCve(cve) : null;
  }

  async getStats() {
    const [dbStats, syncStates] = await Promise.all([
      this.getDbStats(),
      this.syncState.getAll(),
    ]);

    const lastSync: Record<string, string | null> = {};
    for (const s of syncStates) {
      lastSync[s.source] = s.lastSyncAt?.toISOString() ?? null;
    }

    return {
      total: dbStats.total,
      bySeverity: dbStats.bySeverity,
      kevCount: dbStats.kevCount,
      newLast24h: dbStats.newLast24h,
      lastSync,
    };
  }

  async getSyncStatus() {
    const rows = await this.syncState.getAll();
    return rows.map((r) => ({
      source: r.source,
      lastSyncAt: r.lastSyncAt?.toISOString() ?? null,
      lastCursor: r.lastCursor,
      lastCount: r.lastCount,
      errorCount: r.errorCount,
      lastError: r.lastError,
      status: this.computeStatus(r.lastSyncAt),
    }));
  }

  private computeStatus(lastSyncAt: Date | null): 'ok' | 'warn' | 'error' {
    if (!lastSyncAt) return 'error';
    const diffMin = (Date.now() - lastSyncAt.getTime()) / 60000;
    if (diffMin < 35) return 'ok';
    if (diffMin < 120) return 'warn';
    return 'error';
  }

  private async getDbStats(): Promise<DbStatsCache> {
    if (this.statsCache && Date.now() < this.statsCache.expiresAt) {
      return this.statsCache.data;
    }

    const data = await this.cveRepo.getStats();
    this.statsCache = { data, expiresAt: Date.now() + this.STATS_TTL_MS };
    return data;
  }

  private hasListFilters(query: CveQueryDto): boolean {
    return !!(
      query.severity ||
      query.is_kev !== undefined ||
      query.since ||
      query.source ||
      query.search?.trim()
    );
  }

  private mapCveListItem(cve: {
    id: string;
    cveId: string | null;
    sources: string[];
    title: string | null;
    description: string | null;
    severity: string | null;
    cvssScore: { toNumber?: () => number } | number | null;
    epssScore: { toNumber?: () => number } | number | null;
    epssPercentile: { toNumber?: () => number } | number | null;
    isKev: boolean;
    modifiedAt: Date | null;
  }): CveListItemDto {
    return {
      id: cve.id,
      cveId: cve.cveId,
      sources: cve.sources,
      title: cve.title,
      description: cve.description,
      cvssScore: cve.cvssScore != null ? Number(cve.cvssScore) : null,
      severity: cve.severity,
      epssScore: cve.epssScore != null ? Number(cve.epssScore) : null,
      epssPercentile: cve.epssPercentile != null ? Number(cve.epssPercentile) : null,
      isKev: cve.isKev,
      modifiedAt: cve.modifiedAt?.toISOString() ?? null,
    };
  }

  private mapCve(cve: any): CveResponseDto {
    return {
      id: cve.id,
      cveId: cve.cveId,
      sources: cve.sources,
      title: cve.title,
      description: cve.description,
      cvssScore: cve.cvssScore != null ? Number(cve.cvssScore) : null,
      cvssVector: cve.cvssVector,
      cvssVersion: cve.cvssVersion,
      severity: cve.severity,
      epssScore: cve.epssScore != null ? Number(cve.epssScore) : null,
      epssPercentile: cve.epssPercentile != null ? Number(cve.epssPercentile) : null,
      isKev: cve.isKev,
      kevDate: cve.kevDate?.toISOString().slice(0, 10) ?? null,
      kevDueDate: cve.kevDueDate?.toISOString().slice(0, 10) ?? null,
      kevRansomware: cve.kevRansomware,
      affectedPackages: cve.affectedPackages,
      references: cve.references,
      publishedAt: cve.publishedAt?.toISOString() ?? null,
      modifiedAt: cve.modifiedAt?.toISOString() ?? null,
      createdAt: cve.createdAt.toISOString(),
      updatedAt: cve.updatedAt.toISOString(),
    };
  }
}
