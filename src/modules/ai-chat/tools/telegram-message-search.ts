import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ToolResult } from './fit-result';
import { withStatementTimeout } from './statement-timeout';
import { cut } from './tool-args';

const TIMEOUT_MS = 8000;
/** Bounds the `total` count so a broad term never scans every match. */
const TOTAL_CAP = 1000;
const MAX_FALLBACK_TOKENS = 8;
const TEXT_CHARS = 400;
/** Text configurations; each one matches the expression of its GIN index. */
const CONFIGS = ['simple', 'spanish'] as const;

export interface TelegramSearchParams {
  query?: string;
  keywords?: string[];
  channel?: string;
  since?: Date;
  until?: Date;
  limit: number;
}

interface MessageRow {
  channelName: string;
  content: string;
  date: Date;
}

type Db = Pick<PrismaService, '$transaction'>;

/** Escapes the `!` escape character and the LIKE wildcards. */
const likePattern = (text: string) => `%${text.replace(/[!%_]/g, '!$&')}%`;

/** Query words without websearch quotes or exclusion dashes. */
const queryTokens = (query?: string) =>
  (query ?? '')
    .split(/\s+/)
    .map((t) => t.replace(/"/g, '').replace(/^-+/, ''))
    .filter(Boolean)
    .slice(0, MAX_FALLBACK_TOKENS);

function tsQuery(cfg: string, p: TelegramSearchParams): Prisma.Sql {
  const c = Prisma.raw(`'${cfg}'`);
  const parts: Prisma.Sql[] = [];
  if (p.query) parts.push(Prisma.sql`websearch_to_tsquery(${c}, ${p.query})`);
  if (p.keywords?.length) {
    const any = p.keywords.map((k) => Prisma.sql`plainto_tsquery(${c}, ${k})`);
    parts.push(Prisma.sql`(${Prisma.join(any, ' || ')})`);
  }
  return Prisma.sql`(${Prisma.join(parts, ' && ')})`;
}

function filters(p: TelegramSearchParams): Prisma.Sql[] {
  const out: Prisma.Sql[] = [];
  if (p.channel) out.push(Prisma.sql`"channelName" = ${p.channel}`);
  if (p.since) out.push(Prisma.sql`date >= ${p.since}`);
  if (p.until) out.push(Prisma.sql`date <= ${p.until}`);
  return out;
}

function ftsCondition(p: TelegramSearchParams): Prisma.Sql {
  const alternatives = CONFIGS.map(
    (cfg) =>
      Prisma.sql`to_tsvector(${Prisma.raw(`'${cfg}'`)}, content) @@ ${tsQuery(cfg, p)}`,
  );
  return Prisma.sql`(${Prisma.join(alternatives, ' OR ')})`;
}

function trigramCondition(
  tokens: string[],
  keywords: string[],
): Prisma.Sql | undefined {
  const like = (t: string) =>
    Prisma.sql`content ILIKE ${likePattern(t)} ESCAPE '!'`;
  const groups: Prisma.Sql[] = [];
  if (tokens.length) {
    groups.push(Prisma.sql`(${Prisma.join(tokens.map(like), ' AND ')})`);
  }
  if (keywords.length) {
    groups.push(Prisma.sql`(${Prisma.join(keywords.map(like), ' OR ')})`);
  }
  return groups.length ? Prisma.join(groups, ' AND ') : undefined;
}

/** Runs the capped, newest-first page plus the capped total for a condition set. */
function pageOf(db: Db, p: TelegramSearchParams, conditions: Prisma.Sql[]) {
  return withStatementTimeout(db, TIMEOUT_MS, async (tx) => {
    const where = conditions.length
      ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
      : Prisma.empty;
    const rows = await tx.$queryRaw<MessageRow[]>(
      Prisma.sql`SELECT "channelName", content, date FROM telegram_channel_messages
        ${where} ORDER BY date DESC LIMIT ${p.limit}`,
    );
    const [count] = await tx.$queryRaw<{ total: number }[]>(
      Prisma.sql`SELECT count(*)::int AS total FROM (
        SELECT 1 FROM telegram_channel_messages ${where} LIMIT ${Prisma.raw(String(TOTAL_CAP))}) t`,
    );
    return { rows, total: Number(count?.total ?? 0) };
  });
}

function present(
  out: Awaited<ReturnType<typeof pageOf>>,
  usedFallback: boolean,
): ToolResult {
  if ('error' in out) return out;
  return {
    items: out.rows.map((r) => ({
      channel: r.channelName,
      date: r.date.toISOString().slice(0, 10),
      text: cut(r.content, TEXT_CHARS),
    })),
    total: out.total,
    usedFallback,
  };
}

/**
 * Multi-language keyword search over Telegram messages. FTS uses the same
 * `to_tsvector` expressions as the GIN indexes. Zero hits or an FTS error fall
 * back to an escaped trigram ILIKE; both run under their own statement timeout.
 */
export async function searchTelegramMessages(
  db: Db,
  params: TelegramSearchParams,
): Promise<ToolResult> {
  const keywords = params.keywords?.filter(Boolean) ?? [];
  const p = { ...params, keywords };
  if (!p.query && keywords.length === 0) {
    return present(await pageOf(db, p, filters(p)), false);
  }

  const fts = await pageOf(db, p, [ftsCondition(p), ...filters(p)]).catch(
    () => undefined,
  );
  if (fts && ('error' in fts || fts.rows.length > 0))
    return present(fts, false);

  const text = trigramCondition(queryTokens(p.query), keywords);
  if (!text) return { items: [], total: 0, usedFallback: true };
  return present(await pageOf(db, p, [text, ...filters(p)]), true);
}
