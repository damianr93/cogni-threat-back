import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import {
  serializeRansomwareVictim,
  sourceId,
} from '../ingestion/entity-serializers';
import { ToolCall } from '../types/chat.types';
import { VectorRepository } from '../vector/vector.repository';

/** Sources read for one turn; the sidebar can select more than a prompt holds. */
const MAX_SOURCES = 5;
const CHANNEL_MESSAGES = 5;
const SEPARATOR = '\n\n---\n\n';

const CVE_PREFIX = sourceId.vulnCve('');
const VICTIM_PREFIX = sourceId.ransomwareVictim('');
const CHANNEL_PREFIX = 'telegram:channel:';

export type RunTool = (call: ToolCall) => Promise<unknown>;

interface Entry {
  source: string;
  category: string;
  text: string;
}

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;

const asText = (value: unknown) => (typeof value === 'string' ? value : '');

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Builds the text of the sources the user picked in the sidebar. A source with
 * vectors uses its vector text; an SQL-only source (CVE, victim, Telegram
 * channel) is hydrated from the database, so selecting it works without
 * embeddings. One failing source is skipped, never the whole turn.
 */
@Injectable()
export class SourcePrefetcher {
  private readonly logger = new Logger(SourcePrefetcher.name);

  constructor(
    private readonly vectors: Pick<VectorRepository, 'findTextBySources'>,
    private readonly prisma: Pick<PrismaService, 'ransomwareVictimsData'>,
  ) {}

  /** The context text for `sources`, fitted to `maxChars`; empty when nothing was found. */
  async prefetch(
    sources: string[],
    runTool: RunTool,
    maxChars: number,
  ): Promise<string> {
    const wanted = [...new Set(sources)].slice(0, MAX_SOURCES);
    if (wanted.length === 0) return '';

    const vectorText = await this.vectorText(wanted);
    const settled = await Promise.all(
      wanted.map(
        async (source) =>
          vectorText.get(source) ?? (await this.hydrate(source, runTool)),
      ),
    );
    const entries = settled.filter((e): e is Entry => e !== undefined);
    if (entries.length === 0) return '';

    const share = Math.floor(
      (maxChars - SEPARATOR.length * (entries.length - 1)) / entries.length,
    );
    return entries.map((e) => this.format(e, share)).join(SEPARATOR);
  }

  private format({ source, category, text }: Entry, share: number): string {
    const head = `[${category}] `;
    const foot = `\n(fuente: ${source})`;
    return `${head}${clip(text, share - head.length - foot.length)}${foot}`;
  }

  private async vectorText(sources: string[]): Promise<Map<string, Entry>> {
    const found = new Map<string, Entry>();
    try {
      for (const row of await this.vectors.findTextBySources(sources)) {
        const previous = found.get(row.source);
        found.set(row.source, {
          source: row.source,
          category: row.category,
          text: previous ? `${previous.text}\n${row.text}` : row.text,
        });
      }
    } catch (err: unknown) {
      this.warn('vector lookup', err);
    }
    return found;
  }

  private async hydrate(
    source: string,
    runTool: RunTool,
  ): Promise<Entry | undefined> {
    try {
      let text: string | undefined;
      let category: string;
      if (source.startsWith(CVE_PREFIX)) {
        category = 'vuln-monitor';
        text = await this.cve(source.slice(CVE_PREFIX.length), runTool);
      } else if (source.startsWith(VICTIM_PREFIX)) {
        category = 'ransomware';
        text = await this.victim(source.slice(VICTIM_PREFIX.length));
      } else if (source.startsWith(CHANNEL_PREFIX)) {
        category = 'telegram';
        text = await this.channel(source.slice(CHANNEL_PREFIX.length), runTool);
      } else {
        return undefined;
      }
      return text ? { source, category, text } : undefined;
    } catch (err: unknown) {
      this.warn(source, err);
      return undefined;
    }
  }

  private async cve(cveId: string, runTool: RunTool) {
    if (!cveId) return undefined;
    const result = await runTool({ name: 'get_cve', arguments: { cveId } });
    const found = asRecord(result);
    return !found || 'error' in found || found.found === false
      ? undefined
      : JSON.stringify(found);
  }

  private async victim(ransomwareLiveId: string) {
    if (!ransomwareLiveId) return undefined;
    const row = await this.prisma.ransomwareVictimsData.findUnique({
      where: { ransomwareLiveId },
    });
    return row ? serializeRansomwareVictim(row) : undefined;
  }

  private async channel(channel: string, runTool: RunTool) {
    if (!channel) return undefined;
    const result = await runTool({
      name: 'search_telegram_messages',
      arguments: { channel, limit: CHANNEL_MESSAGES },
    });
    const items = asRecord(result)?.items;
    if (!Array.isArray(items) || items.length === 0) return undefined;
    return items
      .map((item) => asRecord(item))
      .map((m) => `[${asText(m?.date)}] ${asText(m?.text)}`)
      .join('\n');
  }

  private warn(what: string, err: unknown) {
    this.logger.warn(
      `Prefetch of ${what} skipped: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}
