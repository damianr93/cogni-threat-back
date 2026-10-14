import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';

/**
 * Expression indexes Prisma cannot declare in schema.prisma. The migration
 * creates them; a later `prisma migrate dev` may propose dropping them, so the
 * boot re-asserts them idempotently.
 */
export const SEARCH_INDEX_STATEMENTS: readonly string[] = [
  `CREATE INDEX IF NOT EXISTS telegram_msg_fts_simple_idx ON telegram_channel_messages USING GIN (to_tsvector('simple', content))`,
  `CREATE INDEX IF NOT EXISTS telegram_msg_fts_spanish_idx ON telegram_channel_messages USING GIN (to_tsvector('spanish', content))`,
];

@Injectable()
export class SearchIndexBootstrap implements OnModuleInit {
  private readonly logger = new Logger(SearchIndexBootstrap.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    for (const statement of SEARCH_INDEX_STATEMENTS) {
      try {
        await this.prisma.$executeRawUnsafe(statement);
      } catch (err) {
        this.logger.warn(
          `Search index bootstrap failed: ${err instanceof Error ? err.message : String(err)}. Telegram search falls back to trigram.`,
        );
      }
    }
  }
}
