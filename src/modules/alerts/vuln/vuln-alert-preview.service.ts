import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../shared/database/prisma.service';
import { VulnPreviewSchema } from './dto/vuln-profile.dto';
import { evaluateVulnSubscription } from './vuln-alert-filter';
import { defaultVulnMonitorSettings, type VulnMonitorSettingsInput } from './vuln-alert.types';
import { VulnWatchProfilesService } from './vuln-watch-profiles.service';

@Injectable()
export class VulnAlertPreviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly profiles: VulnWatchProfilesService,
  ) {}

  async preview(userId: string, body: unknown) {
    const dto = VulnPreviewSchema.parse(body);
    const profiles = await this.profiles.validateProfileIds(userId, dto.profileIds);
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

    const cves = await this.prisma.vulnCve.findMany({
      where: { modifiedAt: { gte: since } },
      orderBy: { modifiedAt: 'desc' },
      take: 200,
    });

    const samples: Array<{
      cveId: string | null;
      severity: string | null;
      matchedProfiles: string[];
      matchedOn: string[];
    }> = [];

    let totalMatches = 0;

    for (const cve of cves) {
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
          matchedProfiles: [...new Set(evalResult.hits.map((h) => h.profileName))],
          matchedOn: evalResult.hits.map((h) => `${h.itemLabel} → ${h.matchedOn}`),
        });
      }
    }

    return { totalMatches, days: dto.days, samples };
  }
}
