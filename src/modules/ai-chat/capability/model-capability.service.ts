import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { AiConfigService } from '../ai-config.service';

export type ToolSupport = 'supported' | 'unsupported' | 'unknown';

const SHOW_TIMEOUT_MS = 5_000;
const KNOWN_TTL_MS = 10 * 60_000;
const UNKNOWN_TTL_MS = 60_000;

interface OllamaShowResponse {
  capabilities?: unknown;
}

interface CacheEntry {
  value: ToolSupport;
  expiresAt: number;
}

/**
 * Detects whether the configured Ollama model supports native tool calling
 * (`/api/show` capabilities). Detection failures resolve to `unknown`, which
 * means "try tools"; they never block a chat turn.
 */
@Injectable()
export class ModelCapabilityService {
  private readonly logger = new Logger(ModelCapabilityService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(private readonly config: AiConfigService) {}

  async getToolSupport(): Promise<ToolSupport> {
    const { ollamaUrl, chatModel } = await this.config.getConfig();
    const key = `${ollamaUrl}|${chatModel}`;
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const value = await this.detect(ollamaUrl, chatModel);
    this.store(key, value);
    return value;
  }

  /** Called when Ollama rejects tools with a 400; sticks for the known-answer TTL. */
  async markUnsupported(): Promise<void> {
    const { ollamaUrl, chatModel } = await this.config.getConfig();
    this.store(`${ollamaUrl}|${chatModel}`, 'unsupported');
  }

  private store(key: string, value: ToolSupport): void {
    const ttl = value === 'unknown' ? UNKNOWN_TTL_MS : KNOWN_TTL_MS;
    this.cache.set(key, { value, expiresAt: Date.now() + ttl });
  }

  private async detect(url: string, model: string): Promise<ToolSupport> {
    try {
      const response = await axios.post<OllamaShowResponse>(
        `${url}/api/show`,
        { model },
        { timeout: SHOW_TIMEOUT_MS },
      );
      const capabilities = response.data?.capabilities;
      if (!Array.isArray(capabilities)) return 'unknown';
      return capabilities.includes('tools') ? 'supported' : 'unsupported';
    } catch (error: unknown) {
      this.logger.warn(
        `Ollama capability lookup failed for ${model}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return 'unknown';
    }
  }
}
