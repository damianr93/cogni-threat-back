import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { envs } from 'libs/config/src/envs';
import { PrismaService } from '../../../shared/database/prisma.service';
import { resolveEmbedScope } from '../ingestion/embed-scope';
import { deriveLabel, sourceId } from '../ingestion/entity-serializers';
import { withStatementTimeout } from '../tools/statement-timeout';
import { ContextSourceItem, ContextSourcesPage } from '../types/chat.types';
import { VectorRepository } from '../vector/vector.repository';

/** Each SQL source gets its own short budget so one slow table never blocks the sidebar. */
const SOURCE_TIMEOUT_MS = 2000;
/** Maximum rows taken from each SQL source. */
const SQL_SOURCE_CAP = 50;
const MAX_PAGE_SIZE = 50;

const CVE_PREFIX = sourceId.vulnCve('');
const VICTIM_PREFIX = sourceId.ransomwareVictim('');
const TELEGRAM_PREFIX = 'telegram:';
const CHANNEL_PREFIX = `${TELEGRAM_PREFIX}channel:`;

export interface ContextSourcesQuery {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
}

/** Escapes the `!` escape character and the LIKE wildcards. */
const likePattern = (text: string) => `%${text.replace(/[!%_]/g, '!$&')}%`;

/**
 * Sidebar source search. Vector sources (groups, actors and whatever the embed
 * scope still keeps) come first, followed by SQL-backed sources: Telegram
 * channels, CVEs and victims, which are not (or not fully) embedded any more.
 */
@Injectable()
export class ContextSourcesService {
  private readonly logger = new Logger(ContextSourcesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly vectors: VectorRepository,
  ) {}

  async list(query: ContextSourcesQuery): Promise<ContextSourcesPage> {
    const limit = Math.min(Math.max(query.limit ?? 20, 1), MAX_PAGE_SIZE);
    const page = Math.max(query.page ?? 1, 1);
    const offset = (page - 1) * limit;
    const search = query.search?.trim() || undefined;
    const scope = resolveEmbedScope(envs);

    const [vector, sql] = await Promise.all([
      this.vectors.listSources({
        limit,
        offset,
        category: query.category,
        search,
        excludeSourcePrefixes: this.gatedPrefixes(scope),
      }),
      this.sqlSources(scope, search, query.category),
    ]);

    const vectorItems = vector.items.map(
      (row): ContextSourceItem => ({
        id: row.source,
        label: deriveLabel(row.source, row.summary),
        category: row.category,
        summary: row.summary || undefined,
      }),
    );
    // SQL items continue the vector list, so a page is a slice of one sequence.
    const sqlStart = Math.max(0, offset - vector.total);
    const sqlItems = sql.slice(sqlStart, sqlStart + limit - vectorItems.length);
    const total = vector.total + sql.length;

    return {
      items: [...vectorItems, ...sqlItems],
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
    };
  }

  private gatedPrefixes(scope: ReturnType<typeof resolveEmbedScope>) {
    const prefixes = [
      scope.cve === 'none' ? CVE_PREFIX : undefined,
      scope.victims === 'none' ? VICTIM_PREFIX : undefined,
      scope.telegram === 'none' ? TELEGRAM_PREFIX : undefined,
    ].filter((p): p is string => p !== undefined);
    return prefixes.length > 0 ? prefixes : undefined;
  }

  private async sqlSources(
    scope: ReturnType<typeof resolveEmbedScope>,
    search: string | undefined,
    category: string | undefined,
  ): Promise<ContextSourceItem[]> {
    const wants = (name: string) => !category || category === name;
    const none: ContextSourceItem[] = [];
    const [channels, cves, victims] = await Promise.all([
      scope.telegram === 'none' && wants('telegram')
        ? this.channels(search)
        : none,
      search && wants('vuln-monitor') ? this.cves(search) : none,
      search && scope.victims === 'none' && wants('ransomware')
        ? this.victims(search)
        : none,
    ]);

    // CVEs and victims that still have vectors are already in the vector list.
    const embedded = await this.vectors.existingSources(
      [...cves, ...victims].map((item) => item.id),
    );
    return [
      ...channels,
      ...cves.filter((i) => !embedded.has(i.id)),
      ...victims.filter((i) => !embedded.has(i.id)),
    ];
  }

  private channels(search?: string): Promise<ContextSourceItem[]> {
    return this.safely('telegram channels', async (tx) => {
      const filter = search
        ? Prisma.sql`WHERE "channelName" ILIKE ${likePattern(search)} ESCAPE '!'`
        : Prisma.empty;
      const rows = await tx.$queryRaw<Array<{ channelName: string }>>(
        Prisma.sql`SELECT "channelName" FROM telegram_channel_messages
          ${filter} GROUP BY "channelName" ORDER BY "channelName" LIMIT ${SQL_SOURCE_CAP}`,
      );
      return rows.map((r) => ({
        id: `${CHANNEL_PREFIX}${r.channelName}`,
        label: r.channelName,
        category: 'telegram',
        summary: `Canal Telegram: ${r.channelName}`,
      }));
    });
  }

  /** Matches the id through its trigram index; exact and prefix matches rank first. */
  private cves(search: string): Promise<ContextSourceItem[]> {
    return this.safely('cves', async (tx) => {
      const pattern = likePattern(search);
      const prefix = pattern.slice(1);
      const rows = await tx.$queryRaw<
        Array<{ id: string; title: string | null }>
      >(
        Prisma.sql`SELECT id, title FROM vuln_cves
          WHERE id ILIKE ${pattern} ESCAPE '!'
          ORDER BY (upper(id) = upper(${search})) DESC,
                   (id ILIKE ${prefix} ESCAPE '!') DESC,
                   "isKev" DESC, "publishedAt" DESC NULLS LAST, id
          LIMIT ${SQL_SOURCE_CAP}`,
      );
      return rows.map((r) => ({
        id: sourceId.vulnCve(r.id),
        label: r.id,
        category: 'vuln-monitor',
        summary: r.title || undefined,
      }));
    });
  }

  private victims(search: string): Promise<ContextSourceItem[]> {
    return this.safely('victims', async (tx) => {
      const rows = await tx.$queryRaw<
        Array<{ ransomwareLiveId: string; victim: string; group: string }>
      >(
        Prisma.sql`SELECT "ransomwareLiveId", victim, "group" FROM ransomware_victims_data
          WHERE victim ILIKE ${likePattern(search)} ESCAPE '!'
          ORDER BY discovered DESC LIMIT ${SQL_SOURCE_CAP}`,
      );
      return rows.map((r) => ({
        id: sourceId.ransomwareVictim(r.ransomwareLiveId),
        label: r.victim,
        category: 'ransomware',
        summary: `Víctima ransomware: ${r.victim} (${r.group})`,
      }));
    });
  }

  /** A slow or failing source is dropped; the sidebar still answers with the rest. */
  private async safely(
    name: string,
    work: (tx: Prisma.TransactionClient) => Promise<ContextSourceItem[]>,
  ): Promise<ContextSourceItem[]> {
    try {
      const out = await withStatementTimeout(
        this.prisma,
        SOURCE_TIMEOUT_MS,
        work,
      );
      if ('error' in out) {
        this.logger.warn(`Context source "${name}" skipped: ${out.error}`);
        return [];
      }
      return out;
    } catch (err: unknown) {
      this.logger.warn(
        `Context source "${name}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      return [];
    }
  }
}
