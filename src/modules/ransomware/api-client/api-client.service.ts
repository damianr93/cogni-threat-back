import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { envs } from 'libs/config/src/envs';
import { SecretsService } from '../../../shared/secret-store/secrets.service';

const API_URL = envs.RANSOMWARE_API_URL;

@Injectable()
export class RansomwareApiClientService {
  private readonly logger = new Logger(RansomwareApiClientService.name);

  constructor(
    private readonly httpService: HttpService,
    private readonly secrets: SecretsService,
  ) {}

  private async resolveApiKey(): Promise<string | null> {
    const key = await this.secrets.get('ransomware_api_key');
    return key?.trim() || null;
  }

  private safeRequestError(error: any): string {
    if (error?.code === 'ETIMEDOUT' || error?.code === 'ECONNABORTED') {
      return 'Connection timeout';
    }
    if (error?.code === 'ENETUNREACH') {
      return 'Network unreachable';
    }
    if (error?.response?.status) {
      return `HTTP ${error.response.status}`;
    }
    return 'Request failed';
  }

  async getVictims() {
    try {
      const apiKey = await this.resolveApiKey();
      if (!apiKey) {
        this.logger.warn('ransomware_api_key not configured — skipping victims fetch');
        return { success: false, error: 'API key not configured', timestamp: new Date() };
      }
      const response = await firstValueFrom(
        this.httpService.get(`${API_URL}/victims/recent?order=discovered`, {
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        })
      );
      return { success: true, data: response.data, timestamp: new Date() };
    } catch (error) {
      const message = this.safeRequestError(error);
      this.logger.warn(`Error fetching victims: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async getVictimsByCountry(countries?: any[]) {
    try {
      if (!countries || countries.length === 0) {
        return { success: false, error: 'No countries provided', timestamp: new Date() };
      }

      const apiKey = await this.resolveApiKey();
      if (!apiKey) {
        this.logger.warn('ransomware_api_key not configured — skipping victims by country fetch');
        return { success: false, error: 'API key not configured', timestamp: new Date() };
      }
      const BATCH_SIZE = 3;
      const DELAY_MS = 1500;
      const results: any[] = [];
      let successCount = 0;
      let errorCount = 0;

      for (let i = 0; i < countries.length; i += BATCH_SIZE) {
        const batch = countries.slice(i, i + BATCH_SIZE);

        const batchResults = await Promise.all(batch.map(async country => {
          try {
            const response = await firstValueFrom(
              this.httpService.get(`${API_URL}/victims/?country=${country.code2}`, {
                headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
                timeout: 60000,
              })
            );
            successCount++;
            return response.data;
          } catch (countryError) {
            errorCount++;
            this.logger.warn(`${country.code2}: ${this.safeRequestError(countryError)}`);
            return [];
          }
        }));

        results.push(...batchResults);
        batchResults.length = 0;

        if (i + BATCH_SIZE < countries.length) {
          await new Promise(resolve => setTimeout(resolve, DELAY_MS));
        }
      }

      return { success: true, data: results, stats: { totalCountries: countries.length, successCount, errorCount }, timestamp: new Date() };
    } catch (error) {
      const message = this.safeRequestError(error);
      this.logger.warn(`Error fetching victims by country: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async getGroups() {
    try {
      const apiKey = await this.resolveApiKey();
      if (!apiKey) {
        this.logger.warn('ransomware_api_key not configured — skipping groups fetch');
        return { success: false, error: 'API key not configured', timestamp: new Date() };
      }
      const response = await firstValueFrom(
        this.httpService.get(`${API_URL}/groups`, {
          headers: { 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
        })
      );
      return { success: true, data: response.data, timestamp: new Date() };
    } catch (error) {
      const message = this.safeRequestError(error);
      this.logger.warn(`Error fetching groups: ${message}`);
      return { success: false, error: message, timestamp: new Date() };
    }
  }

  async Group(name: string) {
    try {
      const apiKey = await this.resolveApiKey();
      if (!apiKey) {
        return { success: false, error: 'API key not configured', timestamp: new Date() };
      }
      const response = await firstValueFrom(
        this.httpService.get(`${API_URL}/groups/${name}`, {
          headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-API-KEY': apiKey },
          timeout: 60000,
        })
      );

      let responseData = response.data;
      if (typeof responseData === 'string') {
        try {
          responseData = JSON.parse(responseData);
        } catch {
          return { success: false, error: `API returned HTML instead of JSON`, timestamp: new Date() };
        }
      }

      return { success: true, data: responseData, timestamp: new Date() };
    } catch (error: any) {
      const errorMessage = this.safeRequestError(error);
      return { success: false, error: errorMessage, timestamp: new Date() };
    }
  }
}
