import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const AskQuestionSchema = z.object({
  question: z.string().min(1),
  conversationId: z.number().int().positive(),
  categories: z.array(z.string()).optional(),
  sources: z.array(z.string()).optional(),
});

export class AskQuestionDto extends createZodDto(AskQuestionSchema) {}
