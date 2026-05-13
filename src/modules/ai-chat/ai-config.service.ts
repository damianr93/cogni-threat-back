import { BadRequestException, Injectable } from '@nestjs/common';
import { envs } from 'libs/config/src/envs';
import { SecretsService } from '../../shared/secret-store/secrets.service';

export interface AiRuntimeConfig {
  ollamaUrl: string;
  chatModel: string;
  embeddingModel: string;
  timeoutMs: number;
  retrieveCandidates: number;
  temperature: number;
  numCtx: number;
  queryMaxChars: number;
  queryInstruct: string;
}

@Injectable()
export class AiConfigService {
  constructor(private readonly secrets: SecretsService) {}

  async getConfig(): Promise<AiRuntimeConfig> {
    return {
      ollamaUrl: this.normalizeUrl(await this.getString('ollama_url', envs.OLLAMA_URL)),
      chatModel: await this.getString('ollama_model', envs.MODEL),
      embeddingModel: await this.getString('ollama_embedding_model', envs.EMBEDDING_MODEL),
      timeoutMs: await this.getPositiveInt('ollama_timeout_ms', envs.OLLAMA_TIMEOUT_MS),
      retrieveCandidates: await this.getPositiveInt('rag_retrieve_candidates', envs.RAG_RETRIEVE_CANDIDATES),
      temperature: await this.getNumber('rag_chat_temperature', envs.RAG_CHAT_TEMPERATURE),
      numCtx: await this.getPositiveInt('rag_chat_num_ctx', envs.RAG_CHAT_NUM_CTX),
      queryMaxChars: await this.getPositiveInt('rag_query_max_chars', envs.RAG_QUERY_MAX_CHARS),
      queryInstruct: await this.getString('rag_query_instruct', envs.RAG_QUERY_INSTRUCT),
    };
  }

  private async getString(key: Parameters<SecretsService['get']>[0], fallback: string): Promise<string> {
    const value = (await this.secrets.get(key))?.trim() || fallback;
    if (!value) throw new BadRequestException(`AI setting ${key} is empty`);
    return value;
  }

  private async getNumber(key: Parameters<SecretsService['get']>[0], fallback: number): Promise<number> {
    const raw = await this.secrets.get(key);
    const value = raw?.trim() ? Number(raw) : fallback;
    if (!Number.isFinite(value)) throw new BadRequestException(`AI setting ${key} must be numeric`);
    return value;
  }

  private async getPositiveInt(key: Parameters<SecretsService['get']>[0], fallback: number): Promise<number> {
    const value = await this.getNumber(key, fallback);
    if (!Number.isInteger(value) || value <= 0) {
      throw new BadRequestException(`AI setting ${key} must be a positive integer`);
    }
    return value;
  }

  private normalizeUrl(url: string): string {
    return url.replace(/\/+$/, '');
  }
}
