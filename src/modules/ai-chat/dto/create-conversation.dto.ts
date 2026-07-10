import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const CreateConversationSchema = z.object({
  title: z.string().min(1).max(200).optional(),
});

export class CreateConversationDto extends createZodDto(
  CreateConversationSchema,
) {}
