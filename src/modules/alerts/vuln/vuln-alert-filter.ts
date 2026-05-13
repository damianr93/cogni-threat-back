import type {
  ProfileInput,
  ProfileMatchHit,
  VulnCveEvalInput,
  VulnMonitorSettingsInput,
} from './vuln-alert.types';
import { DEFAULT_VULN_SEVERITIES } from './vuln-alert.types';
import { matchCveToProfiles } from './vuln-profile.matcher';

export interface VulnSubscriptionEvalResult {
  pass: boolean;
  hits: ProfileMatchHit[];
}

export function passesSeverityGate(cve: VulnCveEvalInput, settings: VulnMonitorSettingsInput): boolean {
  if (settings.isKevOnly && !cve.isKev) return false;

  const severities = (settings.severities?.length ? settings.severities : [...DEFAULT_VULN_SEVERITIES])
    .map((s) => s.toUpperCase());
  const sev = (cve.severity ?? 'UNKNOWN').toUpperCase();
  if (severities.length > 0 && !severities.includes(sev)) return false;

  if (settings.cvssMin != null && cve.cvssScore != null) {
    if (Number(cve.cvssScore) < settings.cvssMin) return false;
  }

  if (settings.epssMin != null && cve.epssScore != null) {
    if (Number(cve.epssScore) < settings.epssMin) return false;
  }

  if (settings.sources && settings.sources.length > 0) {
    const cveSources = cve.sources ?? [];
    if (!settings.sources.some((s) => cveSources.includes(s))) return false;
  }

  return true;
}

export function passesKeywordGate(cve: VulnCveEvalInput, settings: VulnMonitorSettingsInput): boolean {
  const keywords = settings.keywords ?? [];
  if (keywords.length === 0) return true;
  const haystack = `${cve.id} ${cve.cveId ?? ''} ${cve.title ?? ''} ${cve.description ?? ''}`.toLowerCase();
  return keywords.some((kw) => haystack.includes(kw.toLowerCase()));
}

export function evaluateVulnSubscription(
  cve: VulnCveEvalInput,
  settings: VulnMonitorSettingsInput,
  profiles: ProfileInput[],
): VulnSubscriptionEvalResult {
  if (!passesSeverityGate(cve, settings)) {
    return { pass: false, hits: [] };
  }

  const selectedProfiles = profiles.filter((p) => settings.profileIds.includes(p.id));
  const match = matchCveToProfiles(cve, selectedProfiles);

  if (!match.matched) {
    return { pass: false, hits: [] };
  }

  if (!passesKeywordGate(cve, settings)) {
    return { pass: false, hits: [] };
  }

  return { pass: true, hits: match.hits };
}
