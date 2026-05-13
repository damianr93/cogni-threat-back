import { Injectable, Logger } from '@nestjs/common';
import { HttpService } from '@nestjs/axios';
import { firstValueFrom } from 'rxjs';
import { BaseCollector, SyncResult } from './base.collector';
import { VulnCveRepository } from '../repositories/vuln-cve.repository';
import { SyncStateRepository } from '../repositories/sync-state.repository';
import { SecretsService } from '../../../shared/secret-store/secrets.service';

const GITHUB_GRAPHQL = 'https://api.github.com/graphql';

const ADVISORY_QUERY = `
  query($cursor: String, $since: DateTime!) {
    securityAdvisories(
      updatedSince: $since
      first: 100
      after: $cursor
      orderBy: { field: UPDATED_AT, direction: ASC }
    ) {
      pageInfo { endCursor hasNextPage }
      nodes {
        ghsaId
        summary
        description
        severity
        publishedAt
        updatedAt
        withdrawnAt
        cvss { score vectorString }
        epss { percentage percentile }
        identifiers { type value }
        references { url }
        vulnerabilities(first: 10) {
          nodes {
            package { name ecosystem }
            vulnerableVersionRange
            firstPatchedVersion { identifier }
          }
        }
      }
    }
  }
`;

@Injectable()
export class GithubAdvisoryCollector extends BaseCollector {
  readonly source = 'github';
  private readonly logger = new Logger(GithubAdvisoryCollector.name);

  constructor(
    private readonly http: HttpService,
    private readonly cveRepo: VulnCveRepository,
    private readonly syncState: SyncStateRepository,
    private readonly secrets: SecretsService,
  ) {
    super();
  }

  async sync(since?: Date): Promise<SyncResult> {
    const token = await this.secrets.get('github_token');
    if (!token) {
      this.logger.warn('GitHub token not set — skipping GitHub Advisory sync');
      return this.buildResult({ source: this.source, errors: ['GitHub token not configured'] });
    }

    const errors: string[] = [];
    let newItems = 0;
    let updatedItems = 0;

    const lastSync = since ?? (await this.syncState.getLastSync('github'));
    const sinceDate = lastSync ?? this.defaultSince();
    let cursor = await this.syncState.getCursor('github');

    this.logger.log(`GitHub Advisory sync since ${sinceDate.toISOString()}`);

    try {
      let hasNextPage = true;

      while (hasNextPage) {
        const data = await this.query(sinceDate, cursor, token);
        const page = data?.securityAdvisories;
        if (!page) break;

        for (const node of page.nodes ?? []) {
          if (node.withdrawnAt) continue;

          try {
            const mapped = this.mapAdvisory(node);
            const { isNew } = await this.cveRepo.upsert(mapped);
            if (isNew) newItems++;
            else updatedItems++;
          } catch (err: any) {
            errors.push(`${node.ghsaId}: ${err.message}`);
          }
        }

        hasNextPage = page.pageInfo?.hasNextPage ?? false;
        cursor = page.pageInfo?.endCursor ?? null;
        if (hasNextPage) await this.sleep(300);
      }

      await this.syncState.markSuccess('github', newItems + updatedItems, cursor ?? undefined);
      this.logger.log(`GitHub sync done — new: ${newItems}, updated: ${updatedItems}`);
    } catch (err: any) {
      const msg = `GitHub sync failed: ${err.message}`;
      this.logger.error(msg);
      errors.push(msg);
      await this.syncState.markError('github', msg);
    }

    return this.buildResult({ source: this.source, newItems, updatedItems, errors });
  }

  private async query(since: Date, cursor: string | null, token: string) {
    const res = await firstValueFrom(
      this.http.post(
        GITHUB_GRAPHQL,
        { query: ADVISORY_QUERY, variables: { since: since.toISOString(), cursor } },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      ),
    );

    if (res.data?.errors?.length) {
      throw new Error(res.data.errors[0].message);
    }
    return res.data?.data;
  }

  private mapAdvisory(node: any) {
    const cveId =
      (node.identifiers ?? []).find((i: any) => i.type === 'CVE')?.value ?? null;

    const severity = this.mapSeverity(node.severity);

    const affectedPackages = (node.vulnerabilities?.nodes ?? []).map((v: any) => ({
      name: v.package?.name,
      ecosystem: v.package?.ecosystem,
      vulnerableVersionRange: v.vulnerableVersionRange,
      firstPatchedVersion: v.firstPatchedVersion?.identifier ?? null,
    }));

    const refs = (node.references ?? []).map((r: any) => ({ url: r.url }));

    return {
      id: cveId ?? node.ghsaId,
      cveId,
      sources: ['github'] as string[],
      title: node.summary ?? null,
      description: node.description ?? null,
      cvssScore: node.cvss?.score ?? null,
      cvssVector: node.cvss?.vectorString ?? null,
      cvssVersion: node.cvss?.vectorString?.startsWith('CVSS:3') ? '3.1' : null,
      severity,
      epssScore: node.epss?.percentage ?? null,
      epssPercentile: node.epss?.percentile ?? null,
      publishedAt: node.publishedAt ? new Date(node.publishedAt) : null,
      modifiedAt: node.updatedAt ? new Date(node.updatedAt) : null,
      affectedPackages: affectedPackages.length > 0 ? affectedPackages : null,
      references: refs.length > 0 ? refs : null,
      rawGithub: node,
    };
  }

  private mapSeverity(gh: string | null): string | null {
    const map: Record<string, string> = {
      CRITICAL: 'CRITICAL',
      HIGH: 'HIGH',
      MODERATE: 'MEDIUM',
      LOW: 'LOW',
    };
    return gh ? (map[gh] ?? 'UNKNOWN') : null;
  }

  private defaultSince(): Date {
    const d = new Date();
    d.setDate(d.getDate() - 90);
    return d;
  }

  private sleep(ms: number) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
