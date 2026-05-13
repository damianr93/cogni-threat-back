export interface CveMatchInput {
  id: string;
  cveId?: string | null;
  title?: string | null;
  description?: string | null;
  isKev?: boolean;
  affectedPackages?: unknown;
  rawNvd?: unknown;
}

export interface ProfileItemInput {
  id: string;
  label: string;
  query: string;
  vendor?: string | null;
  product?: string | null;
  ecosystem?: string | null;
}

export interface ProfileInput {
  id: string;
  name: string;
  environment?: string;
  items: ProfileItemInput[];
}

export interface ProfileMatchHit {
  profileId: string;
  profileName: string;
  environment?: string;
  itemId: string;
  itemLabel: string;
  matchedOn: string;
}

export interface ProfileMatchResult {
  matched: boolean;
  hits: ProfileMatchHit[];
}

export interface VulnMonitorSettingsInput {
  profileIds: string[];
  severities: string[];
  cvssMin?: number | null;
  epssMin?: number | null;
  isKevOnly?: boolean;
  sources?: string[];
  keywords?: string[];
}

export interface VulnCveEvalInput extends CveMatchInput {
  severity?: string | null;
  cvssScore?: number | string | null;
  epssScore?: number | string | null;
  sources?: string[];
}

export const DEFAULT_VULN_SEVERITIES = ['CRITICAL', 'HIGH'] as const;

export function defaultVulnMonitorSettings(): VulnMonitorSettingsInput {
  return {
    profileIds: [],
    severities: [...DEFAULT_VULN_SEVERITIES],
    cvssMin: null,
    epssMin: null,
    isKevOnly: false,
    sources: [],
    keywords: [],
  };
}
