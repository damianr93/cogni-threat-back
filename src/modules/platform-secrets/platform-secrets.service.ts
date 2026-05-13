import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { envs } from 'libs/config/src/envs';
import { SecretKey, SecretsService } from '../../shared/secret-store/secrets.service';

export interface SecretTestResult {
  ok: boolean | null;
  message: string;
}

/**
 * Validates operational credentials against their upstream API before/after
 * saving. `ok: null` means the credential is not testable in isolation (e.g.
 * Telegram API id/hash/session, which are validated by the login flow).
 */
@Injectable()
export class PlatformSecretsService {
  private readonly logger = new Logger(PlatformSecretsService.name);

  constructor(
    private readonly http: HttpService,
    private readonly secrets: SecretsService,
  ) {}

  async test(key: SecretKey, overrideValue?: string): Promise<SecretTestResult> {
    const value =
      overrideValue && overrideValue.trim().length > 0
        ? overrideValue.trim()
        : await this.secrets.get(key);

    if (!value) {
      return { ok: false, message: 'No value configured to test' };
    }

    switch (key) {
      case 'nvd_api_key':
        return this.testNvd(value);
      case 'github_token':
        return this.testGithub(value);
      case 'ransomware_api_key':
        return this.testRansomware(value);
      case 'bot_token':
        return this.testBotToken(value);
      case 'ollama_url':
      case 'ollama_model':
      case 'ollama_embedding_model':
        return this.testOllama(key, value);
      case 'ollama_timeout_ms':
      case 'rag_retrieve_candidates':
      case 'rag_chat_num_ctx':
      case 'rag_query_max_chars':
        return this.testPositiveInteger(value);
      case 'rag_chat_temperature':
        return this.testNumber(value);
      case 'rag_query_instruct':
        return { ok: value.trim().length > 0, message: 'Instruction prefix configured' };
      default:
        return { ok: null, message: 'Validated through the Telegram login flow' };
    }
  }

  private async testNvd(apiKey: string): Promise<SecretTestResult> {
    try {
      const res = await firstValueFrom(
        this.http.get(`${envs.NVD_API_URL}/cves/2.0`, {
          params: { resultsPerPage: '1' },
          headers: { apiKey },
          timeout: 20000,
        }),
      );
      return { ok: res.status === 200, message: 'NVD responded OK' };
    } catch (err: any) {
      return { ok: false, message: this.httpError(err) };
    }
  }

  private async testGithub(token: string): Promise<SecretTestResult> {
    try {
      const res = await firstValueFrom(
        this.http.post(
          'https://api.github.com/graphql',
          { query: '{ viewer { login } }' },
          {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
            timeout: 20000,
          },
        ),
      );
      if (res.data?.errors?.length) {
        return { ok: false, message: res.data.errors[0].message };
      }
      const login = res.data?.data?.viewer?.login;
      return { ok: !!login, message: login ? `Authenticated as ${login}` : 'No viewer returned' };
    } catch (err: any) {
      return { ok: false, message: this.httpError(err) };
    }
  }

  private async testRansomware(apiKey: string): Promise<SecretTestResult> {
    try {
      const res = await firstValueFrom(
        this.http.get(`${envs.RANSOMWARE_API_URL}/groups`, {
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
          timeout: 20000,
        }),
      );
      return { ok: res.status === 200, message: 'Ransomware.live responded OK' };
    } catch (err: any) {
      return { ok: false, message: this.httpError(err) };
    }
  }

  private async testBotToken(token: string): Promise<SecretTestResult> {
    try {
      const res = await firstValueFrom(
        this.http.get(`https://api.telegram.org/bot${token}/getMe`, { timeout: 15000 }),
      );
      const ok = res.data?.ok === true;
      const username = res.data?.result?.username;
      return { ok, message: ok ? `Bot @${username}` : 'Telegram rejected the token' };
    } catch (err: any) {
      return { ok: false, message: this.httpError(err) };
    }
  }

  private async testOllama(key: SecretKey, value: string): Promise<SecretTestResult> {
    try {
      const baseUrl = key === 'ollama_url'
        ? value.replace(/\/+$/, '')
        : (await this.secrets.get('ollama_url'))?.replace(/\/+$/, '') || envs.OLLAMA_URL.replace(/\/+$/, '');
      const res = await firstValueFrom(this.http.get(`${baseUrl}/api/tags`, { timeout: 15000 }));
      const models = Array.isArray(res.data?.models) ? res.data.models : [];

      if (key === 'ollama_url') {
        return { ok: res.status === 200, message: `Ollama responded with ${models.length} model(s)` };
      }

      const exists = models.some((model: { name?: string }) => model.name === value || model.name?.startsWith(`${value}:`));
      return {
        ok: exists,
        message: exists ? `Model ${value} found in Ollama` : `Model ${value} not found in Ollama`,
      };
    } catch (err: any) {
      return { ok: false, message: this.httpError(err) };
    }
  }

  private testPositiveInteger(value: string): SecretTestResult {
    const number = Number(value);
    return Number.isInteger(number) && number > 0
      ? { ok: true, message: 'Valid positive integer' }
      : { ok: false, message: 'Must be a positive integer' };
  }

  private testNumber(value: string): SecretTestResult {
    return Number.isFinite(Number(value))
      ? { ok: true, message: 'Valid number' }
      : { ok: false, message: 'Must be numeric' };
  }

  private httpError(err: any): string {
    const status = err?.response?.status;
    if (status) return `HTTP ${status}`;
    return err?.message || 'Request failed';
  }
}
