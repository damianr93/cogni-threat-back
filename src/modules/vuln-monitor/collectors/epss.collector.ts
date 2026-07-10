import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as zlib from 'zlib';
import * as readline from 'readline';
import { BaseCollector, SyncResult } from './base.collector';
import { VulnCveRepository } from '../repositories/vuln-cve.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';

const EPSS_BASE = 'https://epss.empiricalsecurity.com';
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

    const today = new Date().toISOString().slice(0, 10);
    const url = `${EPSS_BASE}/epss_scores-${today}.csv.gz`;

    try {
      this.logger.log(`Downloading EPSS scores for ${today}...`);
      const response = await firstValueFrom(
        this.http.get(url, { responseType: 'stream', timeout: 120000 }),
      );

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
      if (err?.response?.status === 404) {
        this.logger.warn(`EPSS file not yet available for ${today}`);
        return this.buildResult({
          source: this.source,
          errors: [`EPSS file not available for ${today}`],
        });
      }
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
}
