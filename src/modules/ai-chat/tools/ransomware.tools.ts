import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ToolResult } from './fit-result';
import { withStatementTimeout } from './statement-timeout';
import { cut, optionalDate, optionalText } from './tool-args';
import { ChatTool, defineTool, limitOf, MAX_TOOL_LIMIT } from './tool.types';

export interface RansomwareToolDeps {
  prisma: Pick<PrismaService, '$transaction'>;
}

const TIMEOUT_MS = 5000;
const LATEST_VICTIMS = 5;
const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
/** Postgres LIKE escapes with `\` by default; Prisma `contains` and insensitive `equals` (both ILIKE) do not escape wildcards. */
const escapeLike = (value: string) => value.replace(/[\\%_]/g, '\\$&');
const ci = (value: string) => ({
  contains: escapeLike(value),
  mode: 'insensitive' as const,
});

const victimsSchema = z.object({
  group: optionalText(80),
  country: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{2}$/, 'expected a 2-letter ISO country code')
    .transform((v) => v.toUpperCase())
    .optional(),
  industry: optionalText(100),
  query: optionalText(100),
  since: optionalDate,
  limit: limitOf(10),
});

const groupSchema = z.object({ name: z.string().trim().min(1).max(80) });

const byGroup = (group: string) => ({
  group: { equals: escapeLike(group), mode: 'insensitive' as const },
});

export function createRansomwareTools({
  prisma,
}: RansomwareToolDeps): ChatTool[] {
  const searchVictims = defineTool({
    name: 'search_ransomware_victims',
    description:
      'Search ransomware victims by group, country (ISO-2), industry, name or date. Returns the total and the newest `limit` victims.',
    parameters: {
      type: 'object',
      properties: {
        group: { type: 'string', description: 'Group name, e.g. "lockbit3".' },
        country: { type: 'string', description: 'ISO-2 code, e.g. "US".' },
        industry: { type: 'string', description: 'Activity sector text.' },
        query: { type: 'string', description: 'Victim name or sector text.' },
        since: {
          type: 'string',
          description: 'Earliest discovery date, YYYY-MM-DD.',
        },
        limit: {
          type: 'number',
          description: `1-${MAX_TOOL_LIMIT}, default 10.`,
        },
      },
    },
    schema: victimsSchema,
    async run(a): Promise<ToolResult> {
      const where: Prisma.RansomwareVictimsDataWhereInput = {
        ...(a.group && byGroup(a.group)),
        ...(a.country && { country: a.country }),
        ...(a.industry && { activity: ci(a.industry) }),
        ...(a.query && {
          OR: [{ victim: ci(a.query) }, { activity: ci(a.query) }],
        }),
        ...(a.since && { discovered: { gte: a.since } }),
      };
      const out = await withStatementTimeout(
        prisma,
        TIMEOUT_MS,
        async (tx) => ({
          total: await tx.ransomwareVictimsData.count({ where }),
          rows: await tx.ransomwareVictimsData.findMany({
            where,
            orderBy: { discovered: 'desc' },
            take: a.limit,
          }),
        }),
      );
      if ('error' in out) return out;
      return {
        total: out.total,
        items: out.rows.map((v) => ({
          id: v.ransomwareLiveId,
          victim: v.victim,
          group: v.group,
          country: v.country,
          activity: v.activity,
          website: v.website,
          discovered: day(v.discovered),
          attackDate: day(v.attackDate),
        })),
      };
    },
  });

  const getGroup = defineTool({
    name: 'get_ransomware_group',
    description:
      'Profile of one ransomware group (name or alternative name): dates, TTPs, exploited CVEs, victim count and the 5 latest victims.',
    parameters: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Group name or alias.' },
      },
      required: ['name'],
    },
    schema: groupSchema,
    async run({ name }): Promise<ToolResult> {
      const out = await withStatementTimeout(prisma, TIMEOUT_MS, async (tx) => {
        const group =
          (await tx.ransomwareGroupsData.findFirst({ where: byGroup(name) })) ??
          (await tx.ransomwareGroupsData.findFirst({
            where: { altname: ci(name) },
          }));
        if (!group) return null;
        const where = byGroup(group.group);
        return {
          group,
          total: await tx.ransomwareVictimsData.count({ where }),
          latest: await tx.ransomwareVictimsData.findMany({
            where,
            orderBy: { discovered: 'desc' },
            take: LATEST_VICTIMS,
          }),
        };
      });
      if (out && 'error' in out) return out;
      if (!out) return { found: false, name };
      const { group: g } = out;
      return {
        found: true,
        group: g.group,
        altname: g.altname,
        description: cut(g.description, 400),
        firstseen: day(g.firstseen),
        lastseen: day(g.lastseen),
        victimsTotal: out.total,
        ttps: g.ttps.slice(0, 15),
        vulnerabilities: g.vulnerabilities.slice(0, 15),
        url: g.url,
        latestVictims: out.latest.map((v) => ({
          id: v.ransomwareLiveId,
          victim: v.victim,
          discovered: day(v.discovered),
        })),
      };
    },
  });

  return [searchVictims, getGroup];
}
