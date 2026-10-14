import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { createHash } from 'crypto';
import { firstValueFrom } from 'rxjs';
import { BaseCollector, SyncResult } from './base.collector';
import { VulnCveRepository } from '../repositories/vuln-cve.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';
import { SecretsService } from '../../../shared/secret-store/secrets.service';
import { NVD_MAX_WINDOW_DAYS, splitDateRange } from '../utils/date-range.util';

const NVD_BASE = 'https://services.nvd.nist.gov/rest/json/cves/2.0';
const RESULTS_PER_PAGE = 2000;
const MAX_RETRIES = 3;
/** NVD's unauthenticated ceiling is 5 requests per rolling 30s window. */
const PUBLIC_RATE_DELAY_MS = 6000;
/** How long a rejected key stays ignored before it is tried again. */
const REJECTED_KEY_COOLDOWN_MS = 60 * 60 * 1000;

function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex');
}

@Injectable()
export class NvdCollector extends BaseCollector {
  readonly source = 'nvd';
  private readonly logger = new Logger(NvdCollector.name);
  /**
   * Set once NVD rejects the configured key. Only a hash is kept, never the
   * secret. Cleared when the key changes or after the cool-down elapses.
   */
  private rejectedKey: { hash: string; at: number } | null = null;

  constructor(
    private readonly http: HttpService,
    private readonly cveRepo: VulnCveRepository,
    private readonly syncState: SyncStateRepository,
    private readonly secrets: SecretsService,
  ) {
    super();
  }

  async sync(since?: Date, until?: Date): Promise<SyncResult> {
    const errors: string[] = [];
    let newItems = 0;
    let updatedItems = 0;

    const lastSync = since ?? (await this.syncState.getLastSync('nvd'));
    const startDate = lastSync ?? this.defaultSince();
    const endDate = until ?? new Date();
    const apiKey = await this.secrets.get('nvd_api_key');
    this.resetRejectedKeyIfStale(apiKey);
    const delay = apiKey && !this.rejectedKey ? 700 : PUBLIC_RATE_DELAY_MS;
    const chunks = splitDateRange(startDate, endDate, NVD_MAX_WINDOW_DAYS);

    this.logger.log(
      `NVD sync from ${startDate.toISOString()} to ${endDate.toISOString()} (${chunks.length} chunk(s))`,
    );

    try {
      for (const chunk of chunks) {
        const rangeResult = await this.syncRange(
          chunk.start,
          chunk.end,
          apiKey,
          delay,
        );
        newItems += rangeResult.newItems;
        updatedItems += rangeResult.updatedItems;
        errors.push(...rangeResult.errors);
        if (rangeResult.failed) {
          await this.syncState.markError(
            'nvd',
            rangeResult.errors[rangeResult.errors.length - 1] ??
              'NVD chunk failed',
          );
          return this.buildResult({
            source: this.source,
            newItems,
            updatedItems,
            errors,
          });
        }
        await this.syncState.markProgress('nvd', chunk.end);
      }

      await this.syncState.markSuccess(
        'nvd',
        newItems + updatedItems,
        undefined,
        endDate,
      );
      this.logger.log(
        `NVD sync done — new: ${newItems}, updated: ${updatedItems}`,
      );
    } catch (err: any) {
      const msg = `NVD sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
      await this.syncState.markError('nvd', msg);
    }

    return this.buildResult({
      source: this.source,
      newItems,
      updatedItems,
      errors,
    });
  }

  private async syncRange(
    startDate: Date,
    endDate: Date,
    apiKey: string | undefined,
    delay: number,
  ): Promise<{
    newItems: number;
    updatedItems: number;
    errors: string[];
    failed: boolean;
  }> {
    const errors: string[] = [];
    let newItems = 0;
    let updatedItems = 0;

    try {
      let startIndex = 0;
      let totalResults = 0;

      do {
        const result = await this.fetchPage(
          startDate,
          endDate,
          startIndex,
          apiKey,
        );
        if (!result) break;

        if (startIndex === 0) {
          totalResults = result.totalResults ?? 0;
          this.logger.log(`NVD total in range: ${totalResults}`);
        }

        for (const vuln of result.vulnerabilities ?? []) {
          try {
            const mapped = this.mapCve(vuln.cve);
            if (!mapped) continue;
            const { isNew } = await this.cveRepo.upsert(mapped);
            if (isNew) newItems++;
            else updatedItems++;
          } catch (err: any) {
            errors.push(`${vuln.cve?.id}: ${err.message}`);
          }
        }

        startIndex += RESULTS_PER_PAGE;
        // Unauthenticated callers get 5 requests per 30s instead of 50, so
        // pacing has to widen once the key is dropped or every page 403s.
        if (startIndex < totalResults) {
          await this.sleep(
            this.rejectedKey ? Math.max(delay, PUBLIC_RATE_DELAY_MS) : delay,
          );
        }
      } while (startIndex < totalResults);

      return { newItems, updatedItems, errors, failed: false };
    } catch (err: any) {
      const msg = `NVD sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
      return { newItems, updatedItems, errors, failed: true };
    }
  }

  private async fetchPage(
    startDate: Date,
    endDate: Date,
    startIndex: number,
    apiKey?: string,
  ): Promise<any> {
    const params: Record<string, string> = {
      lastModStartDate: startDate.toISOString(),
      lastModEndDate: endDate.toISOString(),
      noRejected: '',
      resultsPerPage: String(RESULTS_PER_PAGE),
      startIndex: String(startIndex),
    };

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      const headers: Record<string, string> = {};
      const sentWithKey = Boolean(apiKey) && !this.rejectedKey;
      if (sentWithKey) headers['apiKey'] = apiKey as string;

      try {
        const res = await firstValueFrom(
          this.http.get(NVD_BASE, { params, headers, timeout: 60000 }),
        );
        return res.data;
      } catch (err: unknown) {
        const status = (err as { response?: { status?: number } })?.response
          ?.status;

        // NVD answers an invalid or expired apiKey with 404, not 401 or 403,
        // which looks like a bad path. The unauthenticated endpoint serves the
        // same data, so drop the key and keep collecting.
        if (status === 404 && sentWithKey) {
          this.rejectedKey = {
            hash: hashKey(apiKey as string),
            at: Date.now(),
          };
          this.logger.error(
            'NVD rejected the configured API key (404). Continuing without it, ' +
              'limited to 5 requests per 30s. Check nvd_api_key in the admin panel.',
          );
          // The keyless retry is not a failed attempt; rejectedKey is now set,
          // so this branch cannot run twice for the same page.
          attempt--;
          continue;
        }

        if ((status === 403 || status === 429) && attempt < MAX_RETRIES) {
          this.logger.warn(
            `NVD rate limit (${status}), retry ${attempt}/${MAX_RETRIES} in 30s`,
          );
          await this.sleep(30000);
          continue;
        }
        throw err;
      }
    }
    return null;
  }

  private mapCve(cve: any) {
    if (!cve?.id) return null;
    if (cve.vulnStatus === 'REJECTED') return null;

    const description =
      cve.descriptions?.find((d: any) => d.lang === 'en')?.value ?? null;

    const metrics = cve.metrics ?? {};
    const v31 = metrics.cvssMetricV31?.[0]?.cvssData;
    const v30 = metrics.cvssMetricV30?.[0]?.cvssData;
    const v2 = metrics.cvssMetricV2?.[0]?.cvssData;
    const cvssData = v31 ?? v30 ?? v2 ?? null;
    const cvssVersion = v31 ? '3.1' : v30 ? '3.0' : v2 ? '2.0' : null;

    const refs = (cve.references ?? []).map((r: any) => ({ url: r.url }));

    return {
      id: cve.id,
      cveId: cve.id,
      sources: ['nvd'] as string[],
      title: cve.cisaVulnerabilityName ?? null,
      description,
      cvssScore: cvssData?.baseScore ?? null,
      cvssVector: cvssData?.vectorString ?? null,
      cvssVersion,
      severity: cvssData?.baseSeverity ?? (cvssData ? 'UNKNOWN' : null),
      publishedAt: cve.published ? new Date(cve.published) : null,
      modifiedAt: cve.lastModified ? new Date(cve.lastModified) : null,
      references: refs.length > 0 ? refs : null,
      rawNvd: cve,
    };
  }

  private resetRejectedKeyIfStale(apiKey: string | undefined): void {
    if (!this.rejectedKey) return;
    const keyChanged = !apiKey || hashKey(apiKey) !== this.rejectedKey.hash;
    const expired =
      Date.now() - this.rejectedKey.at >= REJECTED_KEY_COOLDOWN_MS;
    if (keyChanged || expired) this.rejectedKey = null;
  }

  private defaultSince(): Date {
    const d = new Date();
    d.setHours(d.getHours() - 2);
    return d;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
