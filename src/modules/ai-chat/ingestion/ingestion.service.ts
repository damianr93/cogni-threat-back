import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { OllamaEmbeddingsProvider } from '../providers/ollama-embeddings.provider';
import { VectorRepository } from '../vector/vector.repository';
import {
  serializeRansomwareGroup,
  serializeRansomwareVictim,
  serializeVulnCve,
  serializeActor,
  serializeTelegramMessage,
  sourceId,
} from './entity-serializers';

const BATCH_SIZE = 50;

@Injectable()
export class IngestionService implements OnApplicationBootstrap {
  private readonly logger = new Logger(IngestionService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly embeddings: OllamaEmbeddingsProvider,
    private readonly vectors: VectorRepository,
  ) {}

  async onApplicationBootstrap() {
    if (!this.vectors.isReady()) {
      this.logger.warn(
        'pgvector no disponible — ingesta diferida hasta que la extensión esté instalada',
      );
      return;
    }
    const total = await this.vectors.countAll();
    if (total === 0) {
      this.logger.log(
        'Índice vectorial vacío — iniciando ingesta completa inicial',
      );
      void this.ingestAll();
    }
  }

  async ingestAll(): Promise<void> {
    if (!this.vectors.isReady()) {
      this.logger.warn('pgvector no disponible — ingesta omitida');
      return;
    }
    if (this.running) {
      this.logger.warn('Ingesta ya en progreso, omitiendo');
      return;
    }
    this.running = true;
    const start = Date.now();
    this.logger.log('Iniciando ingesta incremental de todas las fuentes');

    try {
      await Promise.all([
        this.ingestRansomwareGroups(),
        this.ingestRansomwareVictims(),
        this.ingestVulnCves(),
        this.ingestActors(),
        this.ingestTelegramMessages(),
      ]);
    } finally {
      this.running = false;
      this.logger.log(
        `Ingesta completa en ${((Date.now() - start) / 1000).toFixed(1)}s`,
      );
    }
  }

  async ingestRansomwareGroups(): Promise<void> {
    const since = await this.getLastSyncAt('ransomware:groups');
    const records = await this.prisma.ransomwareGroupsData.findMany({
      where: since ? { updatedAt: { gt: since } } : undefined,
      orderBy: { updatedAt: 'asc' },
    });

    if (records.length === 0) {
      this.logger.debug('ransomware:groups — sin cambios');
      return;
    }

    this.logger.log(`ransomware:groups — indexando ${records.length} grupos`);
    let indexed = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const texts = batch.map((g) => serializeRansomwareGroup(g));
      const embeddings = await this.embeddings.generateEmbeddingBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const sid = sourceId.ransomwareGroup(batch[j].group);
        await this.vectors.deleteBySource(sid);
        await this.vectors.insertChunk({
          text: texts[j],
          embedding: embeddings[j],
          source: sid,
          category: 'ransomware',
          chunkIndex: 0,
          totalChunks: 1,
        });
        indexed++;
      }
    }

    await this.upsertSyncState('ransomware:groups', indexed);
    this.logger.log(`ransomware:groups — ${indexed} grupos indexados`);
  }

  async ingestRansomwareVictims(): Promise<void> {
    const since = await this.getLastSyncAt('ransomware:victims');
    const records = await this.prisma.ransomwareVictimsData.findMany({
      where: since ? { updatedAt: { gt: since } } : undefined,
      orderBy: { updatedAt: 'asc' },
    });

    if (records.length === 0) {
      this.logger.debug('ransomware:victims — sin cambios');
      return;
    }

    this.logger.log(
      `ransomware:victims — indexando ${records.length} víctimas`,
    );
    let indexed = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const texts = batch.map((v) => serializeRansomwareVictim(v));
      const embeddings = await this.embeddings.generateEmbeddingBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const sid = sourceId.ransomwareVictim(batch[j].ransomwareLiveId);
        await this.vectors.deleteBySource(sid);
        await this.vectors.insertChunk({
          text: texts[j],
          embedding: embeddings[j],
          source: sid,
          category: 'ransomware',
          chunkIndex: 0,
          totalChunks: 1,
        });
        indexed++;
      }
    }

    await this.upsertSyncState('ransomware:victims', indexed);
    this.logger.log(`ransomware:victims — ${indexed} víctimas indexadas`);
  }

  async ingestVulnCves(): Promise<void> {
    const since = await this.getLastSyncAt('vuln-monitor:cves');
    const records = await this.prisma.vulnCve.findMany({
      where: since ? { updatedAt: { gt: since } } : undefined,
      orderBy: { updatedAt: 'asc' },
    });

    if (records.length === 0) {
      this.logger.debug('vuln-monitor:cves — sin cambios');
      return;
    }

    this.logger.log(`vuln-monitor:cves — indexando ${records.length} CVEs`);
    let indexed = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const texts = batch.map((c) => serializeVulnCve(c));
      const embeddings = await this.embeddings.generateEmbeddingBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const sid = sourceId.vulnCve(batch[j].id);
        await this.vectors.deleteBySource(sid);
        await this.vectors.insertChunk({
          text: texts[j],
          embedding: embeddings[j],
          source: sid,
          category: 'vuln-monitor',
          chunkIndex: 0,
          totalChunks: 1,
        });
        indexed++;
      }
    }

    await this.upsertSyncState('vuln-monitor:cves', indexed);
    this.logger.log(`vuln-monitor:cves — ${indexed} CVEs indexados`);
  }

  async ingestActors(): Promise<void> {
    const since = await this.getLastSyncAt('actors');
    const records = await this.prisma.actorsData.findMany({
      where: since ? { updatedAt: { gt: since } } : undefined,
      include: { hitosDatas: { orderBy: { date: 'asc' } } },
      orderBy: { updatedAt: 'asc' },
    });

    if (records.length === 0) {
      this.logger.debug('actors — sin cambios');
      return;
    }

    this.logger.log(`actors — indexando ${records.length} actores`);
    let indexed = 0;

    for (const actor of records) {
      const chunks = serializeActor(actor);
      const sid = sourceId.actor(actor.id);
      await this.vectors.deleteBySource(sid);

      const embeddings = await this.embeddings.generateEmbeddingBatch(chunks);
      const toInsert = chunks.map((text, i) => ({
        text,
        embedding: embeddings[i],
        source: sid,
        category: 'actors',
        chunkIndex: i,
        totalChunks: chunks.length,
      }));
      await this.vectors.insertChunks(toInsert);
      indexed++;
    }

    await this.upsertSyncState('actors', indexed);
    this.logger.log(`actors — ${indexed} actores indexados`);
  }

  async ingestTelegramMessages(): Promise<void> {
    const since = await this.getLastSyncAt('telegram:messages');
    const records = await this.prisma.telegramChannelMessage.findMany({
      where: since ? { createdAt: { gt: since } } : undefined,
      orderBy: { createdAt: 'asc' },
    });

    if (records.length === 0) {
      this.logger.debug('telegram:messages — sin cambios');
      return;
    }

    this.logger.log(`telegram:messages — indexando ${records.length} mensajes`);
    let indexed = 0;

    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const batch = records.slice(i, i + BATCH_SIZE);
      const texts = batch.map((m) => serializeTelegramMessage(m));
      const embeddings = await this.embeddings.generateEmbeddingBatch(texts);

      for (let j = 0; j < batch.length; j++) {
        const msgId = batch[j].messageId ?? batch[j].id;
        const sid = sourceId.telegramMsg(msgId);
        await this.vectors.deleteBySource(sid);
        await this.vectors.insertChunk({
          text: texts[j],
          embedding: embeddings[j],
          source: sid,
          category: 'telegram',
          chunkIndex: 0,
          totalChunks: 1,
        });
        indexed++;
      }
    }

    await this.upsertSyncState('telegram:messages', indexed);
    this.logger.log(`telegram:messages — ${indexed} mensajes indexados`);
  }

  // ─── Sync state helpers ────────────────────────────────────────────────────

  private async getLastSyncAt(source: string): Promise<Date | null> {
    const state = await this.prisma.aiSyncState.findUnique({
      where: { source },
    });
    return state?.lastSyncAt ?? null;
  }

  private async upsertSyncState(source: string, count: number): Promise<void> {
    await this.prisma.aiSyncState.upsert({
      where: { source },
      create: { source, lastSyncAt: new Date(), lastCount: count },
      update: { lastSyncAt: new Date(), lastCount: count },
    });
  }
}
