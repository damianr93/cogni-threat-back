import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../shared/database/prisma.service';
import { VulnCveRepository } from '../../vuln-monitor/repositories/vuln-cve.repository';
import { ToolResult } from './fit-result';
import { withStatementTimeout } from './statement-timeout';
import { ChatTool, defineTool, limitOf, MAX_TOOL_LIMIT } from './tool.types';

export interface CveToolDeps {
  cves: Pick<VulnCveRepository, 'searchForChat' | 'findById' | 'getStats'>;
  prisma: Pick<PrismaService, '$transaction'>;
}

/** Text search and stats scan large tables, so they run under a timeout. */
const CVE_TIMEOUT_MS = 5000;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const SORTS = ['published', 'modified', 'cvss', 'epss'] as const;
const CVE_ID = /^CVE-\d{4}-\d{4,}$/i;

const cut = (text: string | null | undefined, max: number) =>
  !text ? null : text.length > max ? `${text.slice(0, max)}…` : text;
const num = (v: Prisma.Decimal | number | null | undefined) =>
  v === null || v === undefined ? null : Number(v);
const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .transform((v) => v || undefined);

const optionalBool = z.preprocess(
  (v) => (v === 'true' ? true : v === 'false' ? false : v),
  z.boolean().optional(),
);

const optionalNumber = (min: number, max: number) =>
  z.preprocess(
    (v) => (v === undefined || v === null || v === '' ? undefined : Number(v)),
    z.number().finite().min(min).max(max).optional(),
  );

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((v, ctx) => {
    if (!v) return undefined;
    const date = new Date(v);
    if (Number.isNaN(date.getTime())) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `invalid date: ${v}`,
      });
      return z.NEVER;
    }
    return date;
  });

const searchSchema = z.object({
  query: optionalText(200),
  severity: z.preprocess(
    (v) =>
      typeof v === 'string' && v.trim() ? v.trim().toUpperCase() : undefined,
    z.enum(SEVERITIES).optional(),
  ),
  isKev: optionalBool,
  minCvss: optionalNumber(0, 10),
  minEpss: optionalNumber(0, 1),
  product: optionalText(100),
  since: optionalDate,
  sort: z.enum(SORTS).optional(),
  limit: limitOf(10),
});

const getSchema = z.object({
  cveId: z.string().trim().regex(CVE_ID, 'expected an id like CVE-2024-3400'),
});

type JsonRecord = Record<string, unknown>;
const text = (v: unknown) => (typeof v === 'string' ? v : '');

export function createCveTools({ cves, prisma }: CveToolDeps): ChatTool[] {
  const searchCves = defineTool({
    name: 'search_cves',
    description:
      'Search CVEs with exact filters (severity, CVSS, EPSS, KEV, product, date). Returns the matching total and up to `limit` rows. An exact CVE id matches directly.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'CVE id or free text (title, description).',
        },
        severity: { type: 'string', enum: [...SEVERITIES] },
        isKev: {
          type: 'boolean',
          description: 'true = only CISA KEV (actively exploited).',
        },
        minCvss: { type: 'number', description: 'Minimum CVSS (0-10).' },
        minEpss: { type: 'number', description: 'Minimum EPSS (0-1).' },
        product: {
          type: 'string',
          description: 'Vendor or product, e.g. "fortinet".',
        },
        since: {
          type: 'string',
          description: 'Earliest publish date, YYYY-MM-DD.',
        },
        sort: {
          type: 'string',
          enum: [...SORTS],
          description: 'Descending. Default published.',
        },
        limit: {
          type: 'number',
          description: `1-${MAX_TOOL_LIMIT}, default 10.`,
        },
      },
    },
    schema: searchSchema,
    async run(a): Promise<ToolResult> {
      const out = await withStatementTimeout(prisma, CVE_TIMEOUT_MS, (tx) =>
        cves.searchForChat(
          {
            query: a.query,
            severity: a.severity,
            isKev: a.isKev,
            minCvss: a.minCvss,
            minEpss: a.minEpss,
            product: a.product,
            publishedSince: a.since,
            sort: a.sort,
            limit: a.limit,
          },
          tx,
        ),
      );
      if ('error' in out) return out;
      return {
        total: out.total,
        ...(out.productCapped && {
          note: 'Product filter limited to the 500 most recently modified CVEs.',
        }),
        items: out.data.map((c) => ({
          id: c.cveId ?? c.id,
          title: cut(c.title, 120),
          severity: c.severity,
          cvss: num(c.cvssScore),
          epss: num(c.epssScore),
          kev: c.isKev,
          ransomware: c.kevRansomware || undefined,
          published: day(c.publishedAt),
          description: cut(c.description, 160),
        })),
      };
    },
  });

  const getCve = defineTool({
    name: 'get_cve',
    description:
      'Full detail of one CVE: CVSS, current EPSS, KEV data, affected products, references. Use whenever the user names a CVE id.',
    parameters: {
      type: 'object',
      properties: {
        cveId: { type: 'string', description: 'CVE id, e.g. CVE-2024-3400.' },
      },
      required: ['cveId'],
    },
    schema: getSchema,
    async run({ cveId }): Promise<ToolResult> {
      const id = cveId.toUpperCase();
      const c = await cves.findById(id);
      if (!c) return { found: false, cveId: id };
      const packages = Array.isArray(c.affectedPackages)
        ? (c.affectedPackages as JsonRecord[])
        : [];
      const references = Array.isArray(c.references)
        ? (c.references as Array<JsonRecord | string>)
        : [];
      return {
        found: true,
        id: c.cveId ?? c.id,
        title: cut(c.title, 160),
        description: cut(c.description, 700),
        severity: c.severity,
        cvss: num(c.cvssScore),
        cvssVector: c.cvssVector,
        epss: num(c.epssScore),
        epssPercentile: num(c.epssPercentile),
        kev: c.isKev,
        kevDate: day(c.kevDate),
        kevDueDate: day(c.kevDueDate),
        kevRansomware: c.kevRansomware,
        published: day(c.publishedAt),
        modified: day(c.modifiedAt),
        sources: c.sources,
        affectedProducts: packages
          .slice(0, 10)
          .map(
            (p) =>
              [text(p?.vendor), text(p?.product)].filter(Boolean).join('/') ||
              text(p?.name),
          )
          .filter(Boolean),
        affectedProductsTotal: packages.length,
        references: references
          .slice(0, 5)
          .map((r) => cut(typeof r === 'string' ? r : text(r?.url), 120))
          .filter(Boolean),
      };
    },
  });

  const cveStats = defineTool({
    name: 'cve_stats',
    description:
      'Global CVE totals: all CVEs, KEV count, modified in the last 24 h, and counts by severity.',
    parameters: { type: 'object', properties: {} },
    schema: z.object({}),
    async run(): Promise<ToolResult> {
      const out = await withStatementTimeout(prisma, CVE_TIMEOUT_MS, (tx) =>
        cves.getStats(tx),
      );
      return { ...out };
    },
  });

  return [searchCves, getCve, cveStats];
}
