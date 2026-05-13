import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseCollector, SyncResult } from './base.collector';
import { VulnCveRepository } from '../repositories/vuln-cve.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';

const KEV_URL = 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json';

@Injectable()
export class KevCollector extends BaseCollector {
  readonly source = 'kev';
  private readonly logger = new Logger(KevCollector.name);

  constructor(
    private readonly http: HttpService,
    private readonly cveRepo: VulnCveRepository,
    private readonly syncState: SyncStateRepository,
  ) {
    super();
  }

  async sync(): Promise<SyncResult> {
    const errors: string[] = [];
    let newItems = 0;
    let updatedItems = 0;

    try {
      this.logger.log('Fetching CISA KEV catalog...');
      const response = await firstValueFrom(
        this.http.get<{ vulnerabilities: any[] }>(KEV_URL, { timeout: 30000 }),
      );

      const vulnerabilities = response.data?.vulnerabilities ?? [];
      this.logger.log(`KEV catalog has ${vulnerabilities.length} entries`);

      for (const vuln of vulnerabilities) {
        try {
          const cveId: string = vuln.cveID;
          const { record, isNew } = await this.cveRepo.upsert({
            id: cveId,
            cveId,
            sources: ['kev'],
            title: `${vuln.vendorProject} — ${vuln.product}`,
            description: vuln.shortDescription ?? null,
            isKev: true,
            kevDate: vuln.dateAdded ? new Date(vuln.dateAdded) : null,
            kevDueDate: vuln.dueDate ? new Date(vuln.dueDate) : null,
            kevRansomware: vuln.knownRansomwareCampaignUse === 'Known',
            rawKev: vuln,
          });

          if (isNew) newItems++;
          else updatedItems++;
        } catch (err: any) {
          errors.push(`${vuln.cveID}: ${err.message}`);
        }
      }

      await this.syncState.markSuccess('kev', newItems + updatedItems);
      this.logger.log(`KEV sync done — new: ${newItems}, updated: ${updatedItems}`);
    } catch (err: any) {
      const msg = `KEV fetch failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
      await this.syncState.markError('kev', msg);
    }

    return this.buildResult({ source: this.source, newItems, updatedItems, errors });
  }
}
