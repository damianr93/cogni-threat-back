/**
 * Backfill of severity and CVSS data for OSV rows ingested before the collector
 * computed scores from vectors.
 *
 * Only rows with a null severity are read, so existing values (from NVD or
 * GitHub) are never overwritten and a second run finds nothing to change. The
 * CVSS columns are only filled when empty, and `updatedAt` is never written so
 * a backfill does not mark every row as changed for downstream consumers.
 */
import { PrismaClient } from '@prisma/client';
import { resolveOsvSeverity } from './cvss.util';

export const DEFAULT_BACKFILL_BATCH_SIZE = 2000;
const LABEL_ONLY = 'label-only';

export interface OsvBackfillRow {
  id: string;
  severities: unknown;
  label: string | null;
}

export interface ResolvedOsvRow {
  id: string;
  score: number | null;
  vector: string | null;
  version: string | null;
  severity: string;
}

export interface BackfillOptions {
  dryRun: boolean;
  batchSize: number;
  log: (message: string) => void;
}

export interface BackfillStats {
  seen: number;
  resolved: number;
  unresolved: number;
  written: number;
  byVersion: Record<string, number>;
}

type BackfillClient = Pick<PrismaClient, '$queryRaw' | '$executeRaw'>;

/** Pure: derives the severity data for one row, or null if it is unresolvable. */
export function resolveOsvRow(row: OsvBackfillRow): ResolvedOsvRow | null {
  const resolved = resolveOsvSeverity(row.severities, row.label);
  if (!resolved.severity) return null;

  return {
    id: row.id,
    score: resolved.cvssScore,
    vector: resolved.cvssVector,
    version: resolved.cvssVersion,
    severity: resolved.severity,
  };
}

export function assertValidBatchSize(batchSize: number): void {
  if (!Number.isInteger(batchSize) || batchSize <= 0) {
    throw new Error(
      `Invalid --batch value "${batchSize}": expected a positive integer`,
    );
  }
}

export function parseBackfillArgs(
  args: string[],
): Pick<BackfillOptions, 'dryRun' | 'batchSize'> {
  const batchArg = args.find((arg) => arg.startsWith('--batch'));
  let batchSize = DEFAULT_BACKFILL_BATCH_SIZE;

  if (batchArg !== undefined) {
    const raw = batchArg.startsWith('--batch=')
      ? batchArg.slice('--batch='.length)
      : '';
    if (!/^[0-9]+$/.test(raw) || Number(raw) <= 0) {
      throw new Error(
        `Invalid --batch value "${raw}": expected a positive integer`,
      );
    }
    batchSize = Number(raw);
  }

  return { dryRun: args.includes('--dry-run'), batchSize };
}

export async function runOsvSeverityBackfill(
  prisma: BackfillClient,
  { dryRun, batchSize, log }: BackfillOptions,
): Promise<BackfillStats> {
  assertValidBatchSize(batchSize);

  const stats: BackfillStats = {
    seen: 0,
    resolved: 0,
    unresolved: 0,
    written: 0,
    byVersion: {},
  };
  let cursor = '';

  log(`OSV severity backfill: batch=${batchSize}${dryRun ? ' (dry-run)' : ''}`);

  for (;;) {
    // Only the two JSON subpaths that matter travel back: pulling the whole
    // rawOsv document for a batch of thousands exhausts the container memory.
    const rows = await prisma.$queryRaw<OsvBackfillRow[]>`
      SELECT id,
             "rawOsv"->'severity' AS severities,
             "rawOsv"->'database_specific'->>'severity' AS label
      FROM vuln_cves
      WHERE severity IS NULL
        AND "rawOsv" IS NOT NULL
        AND ${cursor} < id
      ORDER BY id ASC
      LIMIT ${batchSize}
    `;
    if (rows.length === 0) break;

    cursor = rows[rows.length - 1].id;
    stats.seen += rows.length;

    const resolved = rows
      .map(resolveOsvRow)
      .filter((row): row is ResolvedOsvRow => row !== null);
    stats.resolved += resolved.length;
    stats.unresolved += rows.length - resolved.length;
    for (const row of resolved) {
      const key = row.version ?? LABEL_ONLY;
      stats.byVersion[key] = (stats.byVersion[key] ?? 0) + 1;
    }

    if (!dryRun && resolved.length > 0) {
      await prisma.$executeRaw`
        UPDATE vuln_cves SET
          severity = v.severity,
          "cvssScore" = COALESCE(vuln_cves."cvssScore", v.score),
          "cvssVector" = COALESCE(vuln_cves."cvssVector", v.vector),
          "cvssVersion" = COALESCE(vuln_cves."cvssVersion", v.version)
        FROM (
          SELECT unnest(${resolved.map((r) => r.id)}::text[]) AS id,
                 unnest(${resolved.map((r) => r.severity)}::text[]) AS severity,
                 unnest(${resolved.map((r) => r.score)}::numeric[]) AS score,
                 unnest(${resolved.map((r) => r.vector)}::text[]) AS vector,
                 unnest(${resolved.map((r) => r.version)}::text[]) AS version
        ) AS v
        WHERE vuln_cves.id = v.id
          AND vuln_cves.severity IS NULL
      `;
      stats.written += resolved.length;
    }

    log(
      `  ...${stats.seen} read, ${stats.resolved} resolved, ${stats.written} written`,
    );
  }

  log(`Read:       ${stats.seen}`);
  log(`Resolved:   ${stats.resolved}`);
  log(`Unresolved: ${stats.unresolved}`);
  log(`Written:    ${stats.written}`);
  log(`By version: ${JSON.stringify(stats.byVersion)}`);
  if (dryRun) log('Dry-run: nothing was written.');

  return stats;
}
