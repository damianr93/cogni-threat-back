import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateNotificationChannelSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  chatIds: z.array(z.string().min(1)).min(1),
});

export class CreateNotificationChannelDto extends createZodDto(
  CreateNotificationChannelSchema,
) {}

export const UpdateNotificationChannelSchema = z.object({
  label: z.string().min(1).max(120).optional(),
  chatIds: z.array(z.string().min(1)).min(1).optional(),
  isActive: z.boolean().optional(),
});

export class UpdateNotificationChannelDto extends createZodDto(
  UpdateNotificationChannelSchema,
) {}
