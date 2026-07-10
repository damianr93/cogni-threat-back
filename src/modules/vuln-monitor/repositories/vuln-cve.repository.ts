import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { CveQueryDto } from '../dto/cve-query.dto';

export interface VulnCveUpsertData {
  id: string;
  cveId?: string | null;
  sources: string[];
  title?: string | null;
  description?: string | null;
  cvssScore?: number | null;
  cvssVector?: string | null;
  cvssVersion?: string | null;
  severity?: string | null;
  epssScore?: number | null;
  epssPercentile?: number | null;
  isKev?: boolean;
  kevDate?: Date | null;
  kevDueDate?: Date | null;
  kevRansomware?: boolean;
  affectedPackages?: Prisma.InputJsonValue;
  references?: Prisma.InputJsonValue;
  publishedAt?: Date | null;
  modifiedAt?: Date | null;
  rawNvd?: Prisma.InputJsonValue;
  rawKev?: Prisma.InputJsonValue;
  rawGithub?: Prisma.InputJsonValue;
  rawOsv?: Prisma.InputJsonValue;
}

const CVE_ID_PATTERN = /^CVE-\d{4}-\d+$/i;

const LIST_SELECT = {
  id: true,
  cveId: true,
  sources: true,
  title: true,
  description: true,
  severity: true,
  cvssScore: true,
  epssScore: true,
  epssPercentile: true,
  isKev: true,
  modifiedAt: true,
} satisfies Prisma.VulnCveSelect;

@Injectable()
export class VulnCveRepository {
  constructor(private readonly prisma: PrismaService) {}

  async upsert(data: VulnCveUpsertData) {
    const existing = await this.prisma.vulnCve.findFirst({
      where: {
        OR: [{ id: data.id }, ...(data.cveId ? [{ cveId: data.cveId }] : [])],
      },
    });

    if (!existing) {
      return {
        record: await this.prisma.vulnCve.create({ data: data as any }),
        isNew: true,
      };
    }

    const mergedSources = Array.from(
      new Set([...existing.sources, ...data.sources]),
    );
    const mergedCvssScore = this.pickHigher(
      existing.cvssScore ? Number(existing.cvssScore) : null,
      data.cvssScore ?? null,
    );
    const isKev = existing.isKev || (data.isKev ?? false);
    const modifiedAt =
      data.modifiedAt && existing.modifiedAt
        ? data.modifiedAt > existing.modifiedAt
          ? data.modifiedAt
          : existing.modifiedAt
        : (data.modifiedAt ?? existing.modifiedAt);

    // Description priority: NVD > GitHub > OSV > existing
    const description = this.mergeDescription(existing.description, data);

    const updatePayload: Prisma.VulnCveUpdateInput = {
      sources: mergedSources,
      isKev,
      modifiedAt,
      description,
      cvssScore: mergedCvssScore,
      cvssVector: data.cvssVector ?? existing.cvssVector,
      cvssVersion: data.cvssVersion ?? existing.cvssVersion,
      severity:
        mergedCvssScore !== null
          ? data.cvssScore !== null
            ? data.severity
            : existing.severity
          : existing.severity,
      epssScore: data.epssScore ?? existing.epssScore,
      epssPercentile: data.epssPercentile ?? existing.epssPercentile,
      ...(isKev && {
        kevDate: data.kevDate ?? existing.kevDate,
        kevDueDate: data.kevDueDate ?? existing.kevDueDate,
        kevRansomware: data.kevRansomware ?? existing.kevRansomware,
      }),
      ...(data.affectedPackages !== undefined && {
        affectedPackages: data.affectedPackages,
      }),
      ...(data.references !== undefined && { references: data.references }),
      ...(data.rawNvd !== undefined && { rawNvd: data.rawNvd }),
      ...(data.rawKev !== undefined && { rawKev: data.rawKev }),
      ...(data.rawGithub !== undefined && { rawGithub: data.rawGithub }),
      ...(data.rawOsv !== undefined && { rawOsv: data.rawOsv }),
      ...(data.title && !existing.title && { title: data.title }),
      ...(data.cveId && !existing.cveId && { cveId: data.cveId }),
    };

    const record = await this.prisma.vulnCve.update({
      where: { id: existing.id },
      data: updatePayload,
    });

    return { record, isNew: false };
  }

  async bulkUpdateEpss(
    batch: { cveId: string; epss: number; percentile: number }[],
  ) {
    if (batch.length === 0) return;
    await this.prisma.$executeRaw`
      UPDATE vuln_cves SET
        epss_score = v.epss,
        epss_percentile = v.percentile,
        updated_at = NOW()
      FROM (
        SELECT unnest(${batch.map((b) => b.cveId)}::text[]) AS cve_id,
               unnest(${batch.map((b) => b.epss)}::numeric[]) AS epss,
               unnest(${batch.map((b) => b.percentile)}::numeric[]) AS percentile
      ) AS v(cve_id, epss, percentile)
      WHERE vuln_cves.cve_id = v.cve_id
         OR vuln_cves.id = v.cve_id
    `;
  }

  async findMany(query: CveQueryDto, options?: { cachedTotal?: number }) {
    const page = Math.max(query.page ?? 1, 1);
    const limit = Math.min(query.limit ?? 50, 200);
    const order = query.order ?? 'desc';

    const sortField: Record<string, Prisma.VulnCveOrderByWithRelationInput> = {
      modified_at: { modifiedAt: order },
      cvss_score: { cvssScore: order },
      epss_score: { epssScore: order },
    };
    const orderBy = sortField[query.sort ?? 'modified_at'] ?? {
      modifiedAt: 'desc',
    };

    const where = this.buildWhere(query);
    const useCachedTotal =
      Object.keys(where).length === 0 && options?.cachedTotal !== undefined;

    const [total, data] = await Promise.all([
      useCachedTotal
        ? Promise.resolve(options.cachedTotal!)
        : this.prisma.vulnCve.count({ where }),
      this.prisma.vulnCve.findMany({
        where,
        orderBy,
        skip: (page - 1) * limit,
        take: limit,
        select: LIST_SELECT,
      }),
    ]);

    return {
      data,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  private buildWhere(query: CveQueryDto): Prisma.VulnCveWhereInput {
    const where: Prisma.VulnCveWhereInput = {};

    if (query.severity) where.severity = query.severity.toUpperCase();
    if (query.is_kev !== undefined) where.isKev = query.is_kev;
    if (query.since) where.modifiedAt = { gte: new Date(query.since) };
    if (query.source) where.sources = { has: query.source };
    if (query.search) {
      const q = query.search.trim();
      if (q) Object.assign(where, this.buildSearchWhere(q));
    }

    return where;
  }

  private buildSearchWhere(q: string): Prisma.VulnCveWhereInput {
    if (CVE_ID_PATTERN.test(q)) {
      const normalized = q.toUpperCase();
      return {
        OR: [
          { cveId: { equals: normalized, mode: 'insensitive' } },
          { id: { equals: normalized, mode: 'insensitive' } },
        ],
      };
    }

    return {
      OR: [
        { id: { contains: q, mode: 'insensitive' } },
        { cveId: { contains: q, mode: 'insensitive' } },
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ],
    };
  }

  async findById(id: string) {
    return this.prisma.vulnCve.findFirst({
      where: { OR: [{ id }, { cveId: id }] },
    });
  }

  async getStats() {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, kevCount, newLast24h, bySeverityRaw] = await Promise.all([
      this.prisma.vulnCve.count(),
      this.prisma.vulnCve.count({ where: { isKev: true } }),
      this.prisma.vulnCve.count({ where: { modifiedAt: { gte: oneDayAgo } } }),
      this.prisma.vulnCve.groupBy({
        by: ['severity'],
        _count: { severity: true },
        where: { severity: { not: null } },
      }),
    ]);

    const bySeverity: Record<string, number> = {};
    for (const row of bySeverityRaw) {
      if (row.severity) bySeverity[row.severity] = row._count.severity;
    }

    return { total, kevCount, newLast24h, bySeverity };
  }

  async findNewSince(since: Date) {
    return this.prisma.vulnCve.findMany({
      where: { modifiedAt: { gte: since } },
      orderBy: { modifiedAt: 'desc' },
      take: 500,
    });
  }

  private pickHigher(a: number | null, b: number | null): number | null {
    if (a === null) return b;
    if (b === null) return a;
    return Math.max(a, b);
  }

  private mergeDescription(
    existing: string | null,
    data: VulnCveUpsertData,
  ): string | null {
    if (data.rawNvd && data.description) return data.description;
    if (data.rawGithub && data.description && !existing)
      return data.description;
    if (data.rawOsv && data.description && !existing) return data.description;
    return existing;
  }
}
