import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiConfigService } from '../ai-config.service';

interface EmbeddingResponse {
  embedding: number[];
}
interface EmbedBatchResponse {
  embeddings: number[][];
}

const FALLBACK_BATCH_CONCURRENCY = 4;
const EMBED_RETRY_ATTEMPTS = 2;
const EMBED_CIRCUIT_BREAKER_MS = 8000;

@Injectable()
export class OllamaEmbeddingsProvider {
  private readonly logger = new Logger(OllamaEmbeddingsProvider.name);
  private consecutiveBatchFailures = 0;
  private batchCooldownUntil = 0;

  constructor(private readonly config: AiConfigService) {}

  async generateEmbedding(text: string): Promise<number[]> {
    const config = await this.config.getConfig();
    const response = await axios.post<EmbeddingResponse>(
      `${config.ollamaUrl}/api/embeddings`,
      { model: config.embeddingModel, prompt: text },
      { timeout: config.timeoutMs },
    );
    return response.data.embedding;
  }

  async generateQueryEmbedding(text: string): Promise<number[]> {
    const normalized = text.replace(/\s+/g, ' ').trim();
    const config = await this.config.getConfig();
    const prefixed = `${config.queryInstruct}${normalized}`;

    try {
      return await this.generateEmbedding(prefixed);
    } catch (err: any) {
      if (!this.isContextLengthError(err)) throw err;
    }

    const truncated = normalized.slice(0, config.queryMaxChars);
    return this.generateEmbedding(`${config.queryInstruct}${truncated}`);
  }

  async generateEmbeddingBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    if (texts.length === 1) return [await this.generateEmbedding(texts[0])];
    if (Date.now() < this.batchCooldownUntil) return this.fallbackBatch(texts);

    const config = await this.config.getConfig();
    for (let attempt = 1; attempt <= EMBED_RETRY_ATTEMPTS; attempt++) {
      try {
        const response = await axios.post<EmbedBatchResponse>(
          `${config.ollamaUrl}/api/embed`,
          { model: config.embeddingModel, input: texts },
          { timeout: config.timeoutMs },
        );
        const { embeddings } = response.data;
        if (!Array.isArray(embeddings)) throw new Error('Respuesta inesperada de /api/embed');
        this.consecutiveBatchFailures = 0;
        this.batchCooldownUntil = 0;
        return embeddings;
      } catch (err: any) {
        if (attempt === EMBED_RETRY_ATTEMPTS) {
          this.consecutiveBatchFailures += 1;
          if (this.consecutiveBatchFailures >= 3) {
            this.batchCooldownUntil = Date.now() + EMBED_CIRCUIT_BREAKER_MS;
          }
          this.logger.warn(`Batch embedding failed after ${EMBED_RETRY_ATTEMPTS} attempts, falling back`);
        }
      }
    }
    return this.fallbackBatch(texts);
  }

  private async fallbackBatch(texts: string[]): Promise<number[][]> {
    const result: number[][] = [];
    for (let i = 0; i < texts.length; i += FALLBACK_BATCH_CONCURRENCY) {
      const slice = texts.slice(i, i + FALLBACK_BATCH_CONCURRENCY);
      const embs = await Promise.all(slice.map((t) => this.generateEmbedding(t)));
      result.push(...embs);
    }
    return result;
  }

  private isContextLengthError(err: unknown): boolean {
    const msg = String((err as any)?.message ?? err ?? '').toLowerCase();
    return (
      msg.includes('input length exceeds the context length') ||
      msg.includes('context length') ||
      msg.includes('prompt is too long')
    );
  }
}
