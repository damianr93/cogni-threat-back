import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { PrismaService } from '../../../shared/database/prisma.service';
import { ToolResult } from './fit-result';
import { withStatementTimeout } from './statement-timeout';
import { cut, optionalText } from './tool-args';
import { ChatTool, defineTool, limitOf, MAX_TOOL_LIMIT } from './tool.types';

export interface ActorToolDeps {
  prisma: Pick<PrismaService, '$transaction'>;
}

const TIMEOUT_MS = 5000;
const LATEST_HITOS = 3;
const day = (d: Date | null | undefined) =>
  d ? d.toISOString().slice(0, 10) : null;
/** Escapes the `!` escape character and the LIKE wildcards. */
const likePattern = (text: string) => `%${text.replace(/[!%_]/g, '!$&')}%`;

interface ActorRow {
  id: string;
  name: string;
  country: string | null;
  aliases: string[];
  description: string | null;
  identificatedDate: Date | null;
}
interface HitoRow {
  actorsDataId: string;
  date: Date;
  description: string;
  target: string;
}

const schema = z.object({
  query: optionalText(100),
  country: optionalText(60),
  limit: limitOf(10),
});

export function createActorTools({ prisma }: ActorToolDeps): ChatTool[] {
  const searchActors = defineTool({
    name: 'search_actors',
    description:
      'Search threat actors by name or alias and country. Returns each actor with aliases and its 3 latest hitos (documented operations).',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Name or alias, e.g. "APT29".' },
        country: { type: 'string', description: 'Origin country text.' },
        limit: {
          type: 'number',
          description: `1-${MAX_TOOL_LIMIT}, default 10.`,
        },
      },
    },
    schema,
    async run(a): Promise<ToolResult> {
      const out = await withStatementTimeout(prisma, TIMEOUT_MS, async (tx) => {
        const conditions: Prisma.Sql[] = [];
        if (a.query) {
          const p = likePattern(a.query);
          conditions.push(
            Prisma.sql`(name ILIKE ${p} ESCAPE '!' OR EXISTS (SELECT 1 FROM unnest(aliases) AS alias WHERE alias ILIKE ${p} ESCAPE '!'))`,
          );
        }
        if (a.country) {
          conditions.push(
            Prisma.sql`country ILIKE ${likePattern(a.country)} ESCAPE '!'`,
          );
        }
        const where = conditions.length
          ? Prisma.sql`WHERE ${Prisma.join(conditions, ' AND ')}`
          : Prisma.empty;
        const actors = await tx.$queryRaw<ActorRow[]>(
          Prisma.sql`SELECT id, name, country, aliases, description, "identificatedDate"
            FROM actors_data ${where} ORDER BY name ASC LIMIT ${a.limit}`,
        );
        if (actors.length === 0) return { actors, hitos: [] as HitoRow[] };
        const hitos = await tx.$queryRaw<HitoRow[]>(
          Prisma.sql`SELECT "actorsDataId", date, description, target FROM (
              SELECT "actorsDataId", date, description, target,
                row_number() OVER (PARTITION BY "actorsDataId" ORDER BY date DESC) AS rn
              FROM hitos_data WHERE "actorsDataId" = ANY(${actors.map((x) => x.id)})
            ) h WHERE rn <= ${LATEST_HITOS} ORDER BY "actorsDataId", date DESC`,
        );
        return { actors, hitos };
      });
      if ('error' in out) return out;
      return {
        items: out.actors.map((x) => ({
          name: x.name,
          country: x.country,
          aliases: x.aliases,
          since: day(x.identificatedDate),
          description: cut(x.description, 300),
          latestHitos: out.hitos
            .filter((h) => h.actorsDataId === x.id)
            .map((h) => ({
              date: day(h.date),
              target: h.target,
              description: cut(h.description, 160),
            })),
        })),
      };
    },
  });

  return [searchActors];
}
