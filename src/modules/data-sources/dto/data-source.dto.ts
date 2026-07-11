import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateDataSourceSchema = z.object({
  name: z.string().min(1).max(200),
  type: z.string().min(1).max(50),
  endpoint: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

export class CreateDataSourceDto extends createZodDto(CreateDataSourceSchema) {}

export const UpdateDataSourceSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  type: z.string().min(1).max(50).optional(),
  endpoint: z.string().max(500).optional(),
  isActive: z.boolean().optional(),
});

export class UpdateDataSourceDto extends createZodDto(UpdateDataSourceSchema) {}
