import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { Readable } from 'stream';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { BaseCollector, SyncResult } from './base.collector';
import { VulnCveRepository } from '../repositories/vuln-cve.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';

type HttpErrorLike = { response?: { status?: number } };

const EPSS_BASE = 'https://epss.empiricalsecurity.com';
/** How many days back to look before giving up on a published score file. */
const EPSS_MAX_LOOKBACK_DAYS = 5;
const BATCH_SIZE = 1000;

@Injectable()
export class EpssCollector extends BaseCollector {
  readonly source = 'epss';
  private readonly logger = new Logger(EpssCollector.name);

  constructor(
    private readonly http: HttpService,
    private readonly cveRepo: VulnCveRepository,
    private readonly syncState: SyncStateRepository,
  ) {
    super();
  }

  async sync(): Promise<SyncResult> {
    const errors: string[] = [];
    let updatedItems = 0;

    try {
      const { response, day } = await this.fetchLatestScores();
      this.logger.log(`Downloading EPSS scores for ${day}...`);

      const gunzip = zlib.createGunzip();
      const rl = readline.createInterface({
        input: response.data.pipe(gunzip),
        crlfDelay: Infinity,
      });

      let batch: { cveId: string; epss: number; percentile: number }[] = [];

      for await (const line of rl) {
        // Skip comment line and header
        if (line.startsWith('#') || line.startsWith('cve,')) continue;

        const parts = line.split(',');
        if (parts.length < 3) continue;

        const [cveId, epssStr, percentileStr] = parts;
        const epss = parseFloat(epssStr);
        const percentile = parseFloat(percentileStr);

        if (!cveId || isNaN(epss) || isNaN(percentile)) continue;

        batch.push({ cveId, epss, percentile });

        if (batch.length >= BATCH_SIZE) {
          await this.cveRepo.bulkUpdateEpss(batch);
          updatedItems += batch.length;
          batch = [];
        }
      }

      if (batch.length > 0) {
        await this.cveRepo.bulkUpdateEpss(batch);
        updatedItems += batch.length;
      }

      await this.syncState.markSuccess('epss', updatedItems);
      this.logger.log(`EPSS sync done — updated scores: ${updatedItems}`);
    } catch (err: any) {
      const msg = `EPSS sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
      await this.syncState.markError('epss', msg);
    }

    return this.buildResult({
      source: this.source,
      newItems: 0,
      updatedItems,
      errors,
    });
  }

  /**
   * Fetches the most recent published score file.
   *
   * The daily export lands some hours into the UTC day, and the bucket answers
   * a not-yet-published object with 403 rather than 404. Walk backwards until
   * a day responds: older scores are better than none.
   */
  private async fetchLatestScores(): Promise<{
    response: { data: Readable };
    day: string;
  }> {
    let lastErr: unknown;

    for (let back = 0; back <= EPSS_MAX_LOOKBACK_DAYS; back++) {
      const day = new Date(Date.now() - back * 86_400_000)
        .toISOString()
        .slice(0, 10);
      try {
        const response = await firstValueFrom(
          this.http.get<Readable>(`${EPSS_BASE}/epss_scores-${day}.csv.gz`, {
            responseType: 'stream',
            timeout: 120000,
          }),
        );
        if (back > 0) {
          this.logger.warn(
            `EPSS file for today is not published yet, using ${day}`,
          );
        }
        return { response, day };
      } catch (err: unknown) {
        const status = (err as HttpErrorLike)?.response?.status;
        // 403 and 404 both mean "not published yet" for this bucket.
        if (status !== 403 && status !== 404) throw err;
        lastErr = err;
      }
    }

    throw lastErr;
  }
}
