import { z } from 'zod';
import { PrismaService } from '../../../shared/database/prisma.service';
import { searchTelegramMessages } from './telegram-message-search';
import { optionalDate, optionalText } from './tool-args';
import { ChatTool, defineTool, limitOf, MAX_TOOL_LIMIT } from './tool.types';

export interface TelegramToolDeps {
  prisma: Pick<PrismaService, '$transaction'>;
}

const MAX_KEYWORDS = 10;

/** Models often send a lone string instead of a list. */
const keywordList = z.preprocess(
  (v) => (typeof v === 'string' ? [v] : v),
  z
    .array(z.string().trim().max(60))
    .max(MAX_KEYWORDS)
    .optional()
    .transform((v) => v?.filter(Boolean)),
);

const schema = z
  .object({
    query: optionalText(200),
    keywords: keywordList,
    channel: optionalText(100),
    since: optionalDate,
    until: optionalDate,
    limit: limitOf(10),
  })
  .refine((a) => a.query || a.keywords?.length || a.channel, {
    message: 'provide query, keywords or channel',
  });

export function createTelegramTools({ prisma }: TelegramToolDeps): ChatTool[] {
  const searchMessages = defineTool({
    name: 'search_telegram_messages',
    description:
      'Search Telegram threat-channel messages (Spanish, English, Russian) by words, newest first. Filter by channel and date. Falls back to partial matching.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Free text, e.g. "lockbit".' },
        keywords: {
          type: 'array',
          items: { type: 'string' },
          description: `Up to ${MAX_KEYWORDS} terms; any may match.`,
        },
        channel: { type: 'string', description: 'Exact channel name.' },
        since: { type: 'string', description: 'ISO date.' },
        until: { type: 'string', description: 'ISO date.' },
        limit: {
          type: 'number',
          description: `1-${MAX_TOOL_LIMIT}, default 10.`,
        },
      },
    },
    schema,
    run: (a) => searchTelegramMessages(prisma, a),
  });

  return [searchMessages];
}
