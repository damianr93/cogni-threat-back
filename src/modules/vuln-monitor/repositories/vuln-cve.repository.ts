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

/** Product matching scans JSON text (no index): bound the ids it may return. */
export const PRODUCT_MATCH_CAP = 500;

export type CveChatSort = 'published' | 'modified' | 'cvss' | 'epss';

export interface CveChatFilters {
  query?: string;
  severity?: string;
  isKev?: boolean;
  minCvss?: number;
  minEpss?: number;
  product?: string;
  publishedSince?: Date;
  sort?: CveChatSort;
  limit: number;
}

const CHAT_ORDER: Record<CveChatSort, Prisma.Sql> = {
  published: Prisma.raw('"publishedAt" DESC NULLS LAST, id ASC'),
  modified: Prisma.raw('"modifiedAt" DESC NULLS LAST, id ASC'),
  cvss: Prisma.raw('"cvssScore" DESC NULLS LAST, id ASC'),
  epss: Prisma.raw('"epssScore" DESC NULLS LAST, id ASC'),
};

/** Escapes LIKE wildcards with `!`, to be paired with `ESCAPE '!'`. */
const likePattern = (text: string) =>
  `%${text.replace(/[!%_]/g, (c) => `!${c}`)}%`;

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

export interface ChatCveRow {
  id: string;
  cveId: string | null;
  title: string | null;
  description: string | null;
  severity: string | null;
  cvssScore: Prisma.Decimal | null;
  epssScore: Prisma.Decimal | null;
  epssPercentile: Prisma.Decimal | null;
  isKev: boolean;
  kevRansomware: boolean;
  publishedAt: Date | null;
  modifiedAt: Date | null;
}

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
    const existingCvssScore = existing.cvssScore
      ? Number(existing.cvssScore)
      : null;
    const mergedCvssScore = this.pickHigher(
      existingCvssScore,
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
      severity: this.mergeSeverity(existing.severity, existingCvssScore, data),
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
    // Columns are camelCase (no @map). "updatedAt" is intentionally not written:
    // the RAG ingestion cursor walks it, and an EPSS refresh must not re-embed.
    await this.prisma.$executeRaw`
      UPDATE vuln_cves SET
        "epssScore" = v.epss,
        "epssPercentile" = v.percentile
      FROM (
        SELECT unnest(${batch.map((b) => b.cveId)}::text[]) AS cve_id,
               unnest(${batch.map((b) => b.epss)}::numeric[]) AS epss,
               unnest(${batch.map((b) => b.percentile)}::numeric[]) AS percentile
      ) AS v(cve_id, epss, percentile)
      WHERE vuln_cves."cveId" = v.cve_id
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

  /**
   * Bounded, parameterised search for the AI chat tools. Pass a transaction
   * client to run it under a per-call `statement_timeout`. A CVE-id query
   * matches exactly; other text is an escaped ILIKE on title/description.
   * Product matching scans the PRODUCT_MATCH_CAP most recently modified ids.
   */
  async searchForChat(
    filters: CveChatFilters,
    db: Prisma.TransactionClient = this.prisma,
  ) {
    const conditions: Prisma.Sql[] = [];
    const query = filters.query?.trim();
    if (query) {
      if (CVE_ID_PATTERN.test(query)) {
        const id = query.toUpperCase();
        conditions.push(Prisma.sql`(id = ${id} OR "cveId" = ${id})`);
      } else {
        const pattern = likePattern(query);
        conditions.push(
          Prisma.sql`(title ILIKE ${pattern} ESCAPE '!' OR description ILIKE ${pattern} ESCAPE '!')`,
        );
      }
    }
    if (filters.severity) {
      conditions.push(Prisma.sql`severity = ${filters.severity}`);
    }
    if (filters.isKev !== undefined) {
      conditions.push(Prisma.sql`"isKev" = ${filters.isKev}`);
    }
    if (filters.minCvss !== undefined) {
      conditions.push(Prisma.sql`"cvssScore" >= ${filters.minCvss}`);
    }
    if (filters.minEpss !== undefined) {
      conditions.push(Prisma.sql`"epssScore" >= ${filters.minEpss}`);
    }
    if (filters.publishedSince) {
      conditions.push(Prisma.sql`"publishedAt" >= ${filters.publishedSince}`);
    }

    let productCapped = false;
    const product = filters.product?.trim();
    if (product) {
      const pattern = likePattern(product);
      const found = await db.$queryRaw<Array<{ id: string }>>(Prisma.sql`
        SELECT id FROM vuln_cves
        WHERE "affectedPackages"::text ILIKE ${pattern} ESCAPE '!'
        ORDER BY "modifiedAt" DESC NULLS LAST
        LIMIT ${PRODUCT_MATCH_CAP}
      `);
      if (found.length === 0) return { total: 0, productCapped, data: [] };
      productCapped = found.length >= PRODUCT_MATCH_CAP;
      conditions.push(Prisma.sql`id = ANY(${found.map((r) => r.id)})`);
    }

    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const order = CHAT_ORDER[filters.sort ?? 'published'];

    const [{ count }] = await db.$queryRaw<Array<{ count: number }>>(
      Prisma.sql`SELECT count(*)::int AS count FROM vuln_cves ${where}`,
    );
    const data = await db.$queryRaw<ChatCveRow[]>(Prisma.sql`
      SELECT id, "cveId", title, description, severity, "cvssScore",
             "epssScore", "epssPercentile", "isKev", "kevRansomware",
             "publishedAt", "modifiedAt"
      FROM vuln_cves ${where}
      ORDER BY ${order}
      LIMIT ${filters.limit}
    `);

    return { total: count, productCapped, data };
  }

  async findById(id: string) {
    return this.prisma.vulnCve.findFirst({
      where: { OR: [{ id }, { cveId: id }] },
    });
  }

  async getStats(db: Prisma.TransactionClient = this.prisma) {
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);

    const [total, kevCount, newLast24h, bySeverityRaw] = await Promise.all([
      db.vulnCve.count(),
      db.vulnCve.count({ where: { isKev: true } }),
      db.vulnCve.count({ where: { modifiedAt: { gte: oneDayAgo } } }),
      db.vulnCve.groupBy({
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

  /**
   * Severity follows whichever score wins the merge. When the merged score is
   * null there is no score to follow, so an existing severity is never
   * discarded and a label-only incoming severity fills the gap.
   */
  private mergeSeverity(
    existingSeverity: string | null,
    existingScore: number | null,
    data: VulnCveUpsertData,
  ): string | null {
    const incomingScore = data.cvssScore ?? null;
    if (incomingScore === null) {
      return existingSeverity ?? data.severity ?? null;
    }
    const incomingWins =
      existingScore === null || incomingScore >= existingScore;
    return incomingWins
      ? (data.severity ?? existingSeverity)
      : (existingSeverity ?? data.severity ?? null);
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
