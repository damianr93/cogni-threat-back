import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { VulnPreviewSchema } from './dto/vuln-profile.dto';
import { evaluateVulnSubscription } from './vuln-alert-filter';
import {
  defaultVulnMonitorSettings,
  type VulnMonitorSettingsInput,
} from './vuln-alert.types';
import { VulnWatchProfilesService } from './vuln-watch-profiles.service';

const SCAN_BATCH = 250;
const SCAN_LIMIT = 5000;

// Everything the matcher and the severity gate read, and nothing else. The
// rawOsv/rawKev/rawGithub blobs are unused here and rawOsv alone averages
// ~89 kB per row, enough to exhaust the container heap across a full scan.
// rawNvd stays because the CPE tokens come from it.
const MATCH_SELECT = {
  id: true,
  cveId: true,
  title: true,
  description: true,
  isKev: true,
  severity: true,
  cvssScore: true,
  epssScore: true,
  sources: true,
  affectedPackages: true,
  rawNvd: true,
} as const;

@Injectable()
export class VulnAlertPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: VulnWatchProfilesService,
  ) {}

  async preview(userId: string, body: unknown) {
    const dto = VulnPreviewSchema.parse(body);
    const profiles = await this.profiles.validateProfileIds(
      userId,
      dto.profileIds,
    );
    const profileInputs = profiles.map((p) => ({
      id: p.id,
      name: p.name,
      environment: p.environment,
      items: p.items.map((item) => ({
        id: item.id,
        label: item.label,
        query: item.query,
        vendor: item.vendor,
        product: item.product,
        ecosystem: item.ecosystem,
      })),
    }));

    const settings: VulnMonitorSettingsInput = {
      ...defaultVulnMonitorSettings(),
      profileIds: dto.profileIds,
      severities: dto.severities ?? defaultVulnMonitorSettings().severities,
      cvssMin: dto.cvssMin ?? null,
      epssMin: dto.epssMin ?? null,
      isKevOnly: dto.isKevOnly ?? false,
      sources: dto.sources ?? [],
      keywords: dto.keywords ?? [],
    };

    const since = new Date();
    since.setDate(since.getDate() - dto.days);

    const samples: Array<{
      cveId: string | null;
      severity: string | null;
      matchedProfiles: string[];
      matchedOn: string[];
    }> = [];

    let totalMatches = 0;
    let scanned = 0;

    // Paged rather than a single window: a large backfill from one feed can
    // own thousands of the most recently modified rows, and a one-page preview
    // would report zero while real matches sit just past the boundary.
    while (scanned < SCAN_LIMIT) {
      const take = Math.min(SCAN_BATCH, SCAN_LIMIT - scanned);
      const batch = await this.prisma.vulnCve.findMany({
        where: { modifiedAt: { gte: since } },
        // id tiebreaker keeps skip/take pages stable when modifiedAt ties.
        orderBy: [{ modifiedAt: 'desc' }, { id: 'asc' }],
        skip: scanned,
        take,
        select: MATCH_SELECT,
      });

      scanned += batch.length;

      for (const cve of batch) {
        const evalResult = evaluateVulnSubscription(
          {
            id: cve.id,
            cveId: cve.cveId,
            title: cve.title,
            description: cve.description,
            isKev: cve.isKev,
            severity: cve.severity,
            cvssScore: cve.cvssScore != null ? Number(cve.cvssScore) : null,
            epssScore: cve.epssScore != null ? Number(cve.epssScore) : null,
            sources: cve.sources,
            affectedPackages: cve.affectedPackages,
            rawNvd: cve.rawNvd,
          },
          settings,
          profileInputs,
        );

        if (!evalResult.pass) continue;
        totalMatches++;
        if (samples.length < 5) {
          samples.push({
            cveId: cve.cveId,
            severity: cve.severity,
            matchedProfiles: [
              ...new Set(evalResult.hits.map((h) => h.profileName)),
            ],
            matchedOn: evalResult.hits.map(
              (h) => `${h.itemLabel} → ${h.matchedOn}`,
            ),
          });
        }
      }

      // A short page means the window is exhausted.
      if (batch.length < take) break;
    }

    return {
      totalMatches,
      days: dto.days,
      scanned,
      truncated: scanned >= SCAN_LIMIT,
      samples,
    };
  }
}
