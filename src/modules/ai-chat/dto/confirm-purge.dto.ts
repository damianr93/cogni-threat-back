import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

// `confirm` is optional at the schema level so a missing value reaches the
// service guard, which answers 400 without touching the database.
export const ConfirmPurgeSchema = z.object({
  confirm: z.boolean().optional(),
  force: z.boolean().optional(),
});

export class ConfirmPurgeDto extends createZodDto(ConfirmPurgeSchema) {}
