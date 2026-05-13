import { z } from 'zod';
import { createZodDto } from 'nestjs-zod';

export const DeleteConversationSchema = z.object({
  conversationId: z.number().int().positive(),
});

export class DeleteConversationDto extends createZodDto(DeleteConversationSchema) {}
