import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

const ThreatDataSchema = z.object({
  limit: z.coerce.number().min(1).max(100).default(50).optional(),
  offset: z.coerce.number().min(0).default(0).optional(),
  severity: z.enum(['low', 'medium', 'high', 'critical']).optional(),
  category: z.string().optional(),
  sourceId: z.string().optional(),
});

export class ThreatDataDto extends createZodDto(ThreatDataSchema) {}
