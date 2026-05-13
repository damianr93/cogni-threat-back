import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const BACKFILL_SOURCES = ['nvd', 'github', 'osv', 'kev'] as const;
const MAX_BACKFILL_DAYS = 365;

export const SyncBackfillSchema = z
  .object({
    source: z.enum(BACKFILL_SOURCES),
    since: z.string().datetime({ offset: true }).or(z.string().date()),
    until: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  })
  .superRefine((data, ctx) => {
    const since = new Date(data.since);
    const until = data.until ? new Date(data.until) : new Date();
    if (since.getTime() >= until.getTime()) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'since must be before until', path: ['since'] });
    }
    if (data.until) {
      const diffDays = (until.getTime() - since.getTime()) / (24 * 60 * 60 * 1000);
      if (diffDays > MAX_BACKFILL_DAYS) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `backfill range cannot exceed ${MAX_BACKFILL_DAYS} days`,
          path: ['until'],
        });
      }
    }
  });

export class SyncBackfillDto extends createZodDto(SyncBackfillSchema) {}

export type BackfillSource = (typeof BACKFILL_SOURCES)[number];

export function parseBackfillDates(dto: SyncBackfillDto): { since: Date; until: Date } {
  return {
    since: new Date(dto.since),
    until: dto.until ? new Date(dto.until) : new Date(),
  };
}
