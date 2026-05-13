import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const UpdateConversationTitleSchema = z.object({
  title: z.string().min(1).max(200),
});

export class UpdateConversationTitleDto extends createZodDto(UpdateConversationTitleSchema) {}
