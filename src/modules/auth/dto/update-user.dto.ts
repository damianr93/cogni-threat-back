import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpdateUserSchema = z.object({
  role: z.enum(['ADMIN', 'USER']).optional(),
  permission: z.enum(['READ', 'WRITE']).optional(),
  isActive: z.boolean().optional(),
});

export class UpdateUserDto extends createZodDto(UpdateUserSchema) {}
