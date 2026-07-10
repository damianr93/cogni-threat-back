import type {
  ProfileInput,
  ProfileMatchHit,
  VulnMonitorSettingsInput,
} from './vuln-alert.types';
import { defaultVulnMonitorSettings } from './vuln-alert.types';
import { evaluateVulnSubscription } from './vuln-alert-filter';

export interface VulnCveRow {
  id: string;
  cveId: string | null;
  title: string | null;
  description: string | null;
  severity: string | null;
  cvssScore: unknown;
  epssScore: unknown;
  epssPercentile: unknown;
  isKev: boolean;
  kevRansomware: boolean;
  sources: string[];
  affectedPackages: unknown;
  rawNvd: unknown;
  modifiedAt: Date | null;
  createdAt: Date;
}

export interface VulnAlertCandidate {
  cve: VulnCveRow;
  hits: ProfileMatchHit[];
}

export function parseVulnMonitorSettings(
  raw: unknown,
): VulnMonitorSettingsInput {
  const base = defaultVulnMonitorSettings();
  if (!raw || typeof raw !== 'object') return base;
  const s = raw as Record<string, unknown>;
  return {
    profileIds: Array.isArray(s.profileIds)
      ? (s.profileIds as string[])
      : base.profileIds,
    severities: Array.isArray(s.severities)
      ? (s.severities as string[])
      : base.severities,
    cvssMin: s.cvssMin != null ? Number(s.cvssMin) : null,
    epssMin: s.epssMin != null ? Number(s.epssMin) : null,
    isKevOnly: Boolean(s.isKevOnly),
    sources: Array.isArray(s.sources) ? (s.sources as string[]) : [],
    keywords: Array.isArray(s.keywords) ? (s.keywords as string[]) : [],
  };
}

export function findVulnAlertCandidates(
  cves: VulnCveRow[],
  settings: VulnMonitorSettingsInput,
  profiles: ProfileInput[],
): VulnAlertCandidate[] {
  if (!settings.profileIds.length) return [];

  const selected = profiles.filter((p) => settings.profileIds.includes(p.id));
  const results: VulnAlertCandidate[] = [];

  for (const cve of cves) {
    const evaluation = evaluateVulnSubscription(
      {
        id: cve.id,
        cveId: cve.cveId,
        title: cve.title,
        description: cve.description,
        isKev: cve.isKev,
        severity: cve.severity,
        cvssScore: cve.cvssScore as number | null,
        epssScore: cve.epssScore as number | null,
        sources: cve.sources,
        affectedPackages: cve.affectedPackages,
        rawNvd: cve.rawNvd,
      },
      settings,
      selected,
    );
    if (evaluation.pass) {
      results.push({ cve, hits: evaluation.hits });
    }
  }

  return results;
}
