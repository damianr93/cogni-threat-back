import {
  BadRequestException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { envs } from 'libs/config/src/envs';
import { PrismaService } from '../database/prisma.service';
import { SecretsCryptoService } from '../crypto/secrets-crypto.service';

export type SecretKey =
  | 'nvd_api_key'
  | 'github_token'
  | 'ransomware_api_key'
  | 'telegram_api_id'
  | 'telegram_api_hash'
  | 'telegram_session_string'
  | 'bot_token'
  | 'ollama_url'
  | 'ollama_model'
  | 'ollama_embedding_model'
  | 'ollama_timeout_ms'
  | 'rag_retrieve_candidates'
  | 'rag_chat_temperature'
  | 'rag_chat_num_ctx'
  | 'rag_query_max_chars'
  | 'rag_query_instruct';

interface SecretSlot {
  key: SecretKey;
  label: string;
  envFallback: () => string | undefined;
}

export interface SecretDescriptor {
  key: SecretKey;
  label: string;
  isConfigured: boolean;
  source: 'db' | 'env' | 'none';
  maskedValue: string | null;
}

/**
 * Resolver for operational third-party secrets.
 *
 * Precedence: encrypted DB value (when the store is enabled) wins; otherwise
 * falls back to the env value. This keeps production working during rollout —
 * secrets can move from env to the panel one at a time without downtime.
 *
 * Write-only contract: `get()` is for internal consumers only. Anything exposed
 * to HTTP must go through `describe()`, which never returns plaintext.
 */
@Injectable()
export class SecretsService {
  private readonly logger = new Logger(SecretsService.name);
  private readonly cache = new Map<SecretKey, string | null>();

  private readonly slots: SecretSlot[] = [
    {
      key: 'nvd_api_key',
      label: 'NVD API Key',
      envFallback: () => envs.NVD_API_KEY,
    },
    {
      key: 'github_token',
      label: 'GitHub Token',
      envFallback: () => envs.GITHUB_TOKEN,
    },
    {
      key: 'ransomware_api_key',
      label: 'Ransomware.live API Key',
      envFallback: () => envs.RANSOMWARE_API_KEY,
    },
    {
      key: 'telegram_api_id',
      label: 'Telegram API ID',
      envFallback: () => envs.TELEGRAM_API_ID,
    },
    {
      key: 'telegram_api_hash',
      label: 'Telegram API Hash',
      envFallback: () => envs.TELEGRAM_API_HASH,
    },
    {
      key: 'telegram_session_string',
      label: 'Telegram Session String',
      envFallback: () => envs.TELEGRAM_SESSION_STRING,
    },
    {
      key: 'bot_token',
      label: 'Telegram Bot Token',
      envFallback: () => envs.BOT_TOKEN,
    },
    {
      key: 'ollama_url',
      label: 'Ollama URL',
      envFallback: () => envs.OLLAMA_URL,
    },
    {
      key: 'ollama_model',
      label: 'Ollama chat model',
      envFallback: () => envs.MODEL,
    },
    {
      key: 'ollama_embedding_model',
      label: 'Ollama embedding model',
      envFallback: () => envs.EMBEDDING_MODEL,
    },
    {
      key: 'ollama_timeout_ms',
      label: 'Ollama timeout (ms)',
      envFallback: () => String(envs.OLLAMA_TIMEOUT_MS),
    },
    {
      key: 'rag_retrieve_candidates',
      label: 'RAG retrieve candidates',
      envFallback: () => String(envs.RAG_RETRIEVE_CANDIDATES),
    },
    {
      key: 'rag_chat_temperature',
      label: 'RAG chat temperature',
      envFallback: () => String(envs.RAG_CHAT_TEMPERATURE),
    },
    {
      key: 'rag_chat_num_ctx',
      label: 'RAG chat context tokens',
      envFallback: () => String(envs.RAG_CHAT_NUM_CTX),
    },
    {
      key: 'rag_query_max_chars',
      label: 'RAG query max chars',
      envFallback: () => String(envs.RAG_QUERY_MAX_CHARS),
    },
    {
      key: 'rag_query_instruct',
      label: 'RAG query instruction prefix',
      envFallback: () => envs.RAG_QUERY_INSTRUCT,
    },
  ];

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: SecretsCryptoService,
  ) {}

  /** Whether the encrypted DB store is available (SECRETS_MASTER_KEY set). */
  get storeEnabled(): boolean {
    return this.crypto.isEnabled;
  }

  /** Internal resolution — DB (decrypted) first, then env fallback. */
  async get(key: SecretKey): Promise<string | undefined> {
    if (this.cache.has(key)) {
      return this.cache.get(key) ?? undefined;
    }

    let value: string | undefined;

    if (this.crypto.isEnabled) {
      const row = await this.prisma.platformSecret.findUnique({
        where: { key },
      });
      if (row) {
        try {
          value = this.crypto.decrypt(row.encryptedValue);
        } catch (err) {
          this.logger.error(
            `Failed to decrypt secret '${key}': ${(err as Error).message}`,
          );
        }
      }
    }

    if (value === undefined) {
      value = this.slotFor(key)?.envFallback();
    }

    this.cache.set(key, value ?? null);
    return value;
  }

  /** Stores an encrypted secret. Never logs or returns the value. */
  async set(key: SecretKey, value: string, updatedBy?: string): Promise<void> {
    this.assertKnown(key);
    if (!value || value.trim().length === 0) {
      throw new BadRequestException('Secret value cannot be empty');
    }
    if (!this.crypto.isEnabled) {
      throw new ServiceUnavailableException(
        'Secret store disabled: SECRETS_MASTER_KEY not configured',
      );
    }

    const encryptedValue = this.crypto.encrypt(value);
    await this.prisma.platformSecret.upsert({
      where: { key },
      create: { key, encryptedValue, updatedBy },
      update: { encryptedValue, updatedBy },
    });
    this.cache.delete(key);
  }

  /** Removes the stored secret; the resolver falls back to env afterwards. */
  async clear(key: SecretKey): Promise<void> {
    this.assertKnown(key);
    await this.prisma.platformSecret.deleteMany({ where: { key } });
    this.cache.delete(key);
  }

  /** UI-facing view. Masks values; never exposes plaintext. */
  async describe(): Promise<SecretDescriptor[]> {
    const rows = this.crypto.isEnabled
      ? await this.prisma.platformSecret.findMany()
      : [];
    const dbValues = new Map(rows.map((r) => [r.key, r.encryptedValue]));

    return this.slots.map((slot) => {
      const encrypted = dbValues.get(slot.key);
      if (encrypted) {
        let maskedValue: string | null;
        try {
          maskedValue = this.mask(this.crypto.decrypt(encrypted));
        } catch {
          maskedValue = '••••';
        }
        return {
          key: slot.key,
          label: slot.label,
          isConfigured: true,
          source: 'db' as const,
          maskedValue,
        };
      }

      const envValue = slot.envFallback();
      if (envValue) {
        return {
          key: slot.key,
          label: slot.label,
          isConfigured: true,
          source: 'env' as const,
          maskedValue: this.mask(envValue),
        };
      }

      return {
        key: slot.key,
        label: slot.label,
        isConfigured: false,
        source: 'none' as const,
        maskedValue: null,
      };
    });
  }

  isKnownKey(key: string): key is SecretKey {
    return this.slots.some((slot) => slot.key === key);
  }

  private assertKnown(key: string): asserts key is SecretKey {
    if (!this.isKnownKey(key)) {
      throw new BadRequestException(`Unknown secret key: ${key}`);
    }
  }

  private slotFor(key: SecretKey): SecretSlot | undefined {
    return this.slots.find((slot) => slot.key === key);
  }

  private mask(value: string): string {
    if (value.length <= 4) {
      return '••••';
    }
    return `••••${value.slice(-4)}`;
  }
}
