import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import * as readline from 'readline';
import { BaseCollector, SyncResult } from './base.collector';
import { VulnCveRepository } from '../repositories/vuln-cve.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';
import { parseCvssVector, severityFromScore } from '../utils/cvss.util';

const MODIFIED_CSV =
  'https://osv-vulnerabilities.storage.googleapis.com/modified_id.csv';
const OSV_DETAIL = 'https://api.osv.dev/v1/vulns';
const CHECKPOINT_EVERY = 200;
const SEVERITY_LABELS = ['NONE', 'LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
// GitHub-reviewed advisories use MODERATE where CVSS uses MEDIUM.
const SEVERITY_LABEL_ALIASES: Record<string, string> = { MODERATE: 'MEDIUM' };

interface OsvModifiedEntry {
  id: string;
  ts: string;
}

@Injectable()
export class OsvCollector extends BaseCollector {
  readonly source = 'osv';
  private readonly logger = new Logger(OsvCollector.name);

  constructor(
    private readonly http: HttpService,
    private readonly cveRepo: VulnCveRepository,
    private readonly syncState: SyncStateRepository,
  ) {
    super();
  }

  async sync(since?: Date): Promise<SyncResult>;
  async sync(opts?: { maxItems?: number }): Promise<SyncResult>;
  async sync(sinceOrOpts?: Date | { maxItems?: number }): Promise<SyncResult> {
    const since = sinceOrOpts instanceof Date ? sinceOrOpts : undefined;
    const maxItems =
      sinceOrOpts instanceof Date ? undefined : sinceOrOpts?.maxItems;

    const errors: string[] = [];
    let newItems = 0;
    let updatedItems = 0;

    const lastSync = since ?? (await this.syncState.getLastSync('osv'));
    const useCheckpoints = maxItems == null;

    try {
      const modified = await this.fetchModifiedIds(lastSync);
      const entries = maxItems
        ? modified.entries.slice(0, maxItems)
        : modified.entries;
      this.logger.log(
        `OSV: ${entries.length} entries to process${maxItems ? ` (capped at ${maxItems})` : ''} of ${modified.entries.length} modified`,
      );

      let processedSinceCheckpoint = 0;
      let lastProcessedTs: string | null = null;
      let lastCheckpointWatermark: Date | null = null;

      for (const entry of entries) {
        try {
          const detail = await this.fetchDetail(entry.id);
          if (!detail) continue;

          const mapped = this.mapOsv(detail);
          const { isNew } = await this.cveRepo.upsert(mapped);
          if (isNew) newItems++;
          else updatedItems++;

          lastProcessedTs = entry.ts;
          processedSinceCheckpoint++;

          if (
            useCheckpoints &&
            processedSinceCheckpoint >= CHECKPOINT_EVERY &&
            lastProcessedTs
          ) {
            lastCheckpointWatermark = new Date(lastProcessedTs);
            await this.syncState.markProgress(
              'osv',
              lastCheckpointWatermark,
              modified.cursor ?? undefined,
            );
            processedSinceCheckpoint = 0;
          }

          await this.sleep(100);
        } catch (err: any) {
          errors.push(`${entry.id}: ${err.message}`);
        }
      }

      const finalWatermark = lastProcessedTs
        ? new Date(lastProcessedTs)
        : (lastSync ?? new Date());

      if (errors.length === 0) {
        await this.syncState.markSuccess(
          'osv',
          newItems + updatedItems,
          maxItems ? undefined : (modified.cursor ?? undefined),
          finalWatermark,
        );
      } else {
        await this.syncState.markError(
          'osv',
          errors[errors.length - 1] ?? 'OSV sync had errors',
        );
      }
      this.logger.log(
        `OSV sync done — new: ${newItems}, updated: ${updatedItems}`,
      );
    } catch (err: any) {
      const msg = `OSV sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
      await this.syncState.markError('osv', msg);
    }

    return this.buildResult({
      source: this.source,
      newItems,
      updatedItems,
      errors,
    });
  }

  private async fetchModifiedIds(
    since: Date | null,
  ): Promise<{ entries: OsvModifiedEntry[]; cursor: string | null }> {
    const response = await firstValueFrom(
      this.http.get(MODIFIED_CSV, { responseType: 'stream', timeout: 60000 }),
    );

    return new Promise((resolve, reject) => {
      const entries: OsvModifiedEntry[] = [];
      let cursor: string | null = null;
      let isFirst = true;

      const rl = readline.createInterface({
        input: response.data,
        crlfDelay: Infinity,
      });

      rl.on('line', (line) => {
        const trimmed = line.trim();
        if (!trimmed) return;

        const commaIdx = trimmed.indexOf(',');
        if (commaIdx === -1) return;

        const ts = trimmed.substring(0, commaIdx).trim();
        const rawId = trimmed.substring(commaIdx + 1).trim();

        if (isFirst) {
          cursor = ts;
          isFirst = false;
        }

        if (since && new Date(ts) <= since) {
          rl.close();
          return;
        }

        const slashIdx = rawId.indexOf('/');
        const osvId = slashIdx !== -1 ? rawId.substring(slashIdx + 1) : rawId;
        entries.push({ id: osvId, ts });
      });

      rl.on('close', () => resolve({ entries, cursor }));
      rl.on('error', reject);
    });
  }

  private async fetchDetail(osvId: string) {
    try {
      const res = await firstValueFrom(
        this.http.get(`${OSV_DETAIL}/${osvId}`, { timeout: 15000 }),
      );
      return res.data;
    } catch (err: any) {
      if (err?.response?.status === 404) return null;
      throw err;
    }
  }

  private mapOsv(vuln: any) {
    const aliases: string[] = vuln.aliases ?? [];
    const cveId = aliases.find((a: string) => a.startsWith('CVE-')) ?? null;
    const ghsaId = aliases.find((a: string) => a.startsWith('GHSA-')) ?? null;

    const id = cveId ?? ghsaId ?? vuln.id;

    const { cvssScore, cvssVector, cvssVersion, severity } =
      this.mapSeverity(vuln);

    const affectedPackages = (vuln.affected ?? []).map((a: any) => ({
      name: a.package?.name,
      ecosystem: a.package?.ecosystem,
      versions: a.versions ?? [],
    }));

    const refs = (vuln.references ?? []).map((r: any) => ({ url: r.url }));

    return {
      id,
      cveId,
      sources: ['osv'] as string[],
      title: vuln.summary ?? null,
      description: vuln.details ?? null,
      cvssScore,
      cvssVector,
      cvssVersion,
      severity,
      publishedAt: vuln.published ? new Date(vuln.published) : null,
      modifiedAt: vuln.modified ? new Date(vuln.modified) : null,
      affectedPackages: affectedPackages.length > 0 ? affectedPackages : null,
      references: refs.length > 0 ? refs : null,
      rawOsv: vuln,
    };
  }

  /**
   * OSV publishes CVSS vectors but never the numeric score, so the score is
   * recomputed locally. An advisory may carry several vectors: a scored 3.1
   * vector wins, then any scored vector, then the first recognised vector
   * (kept for visibility, e.g. CVSS 4.0, which is not scored). When no score
   * is available the advisory's own `database_specific.severity` label is
   * used. A malformed vector with no label yields a null severity and the
   * advisory is still ingested.
   */
  private mapSeverity(vuln: any): {
    cvssScore: number | null;
    cvssVector: string | null;
    cvssVersion: string | null;
    severity: string | null;
  } {
    const entries: any[] = Array.isArray(vuln.severity) ? vuln.severity : [];
    const parsed = entries
      .filter((entry) => typeof entry?.score === 'string')
      .map((entry) => ({
        vector: entry.score as string,
        ...parseCvssVector(entry.score),
      }))
      .filter((entry) => entry.version !== null);

    const best =
      parsed.find((e) => e.score !== null && e.version === '3.1') ??
      parsed.find((e) => e.score !== null) ??
      parsed[0] ??
      null;

    return {
      cvssScore: best?.score ?? null,
      cvssVector: best?.vector ?? null,
      cvssVersion: best?.version ?? null,
      severity:
        severityFromScore(best?.score, best?.version) ??
        this.normalizeSeverityLabel(vuln.database_specific?.severity),
    };
  }

  private normalizeSeverityLabel(value: unknown): string | null {
    if (typeof value !== 'string') return null;
    const upper = value.trim().toUpperCase();
    const label = SEVERITY_LABEL_ALIASES[upper] ?? upper;
    return SEVERITY_LABELS.includes(label) ? label : null;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
