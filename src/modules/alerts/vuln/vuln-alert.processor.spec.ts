import { findVulnAlertCandidates, parseVulnMonitorSettings } from './vuln-alert.processor';
import type { ProfileInput } from './vuln-alert.types';

describe('vuln-alert.processor', () => {
  const profile: ProfileInput = {
    id: 'p1',
    name: 'Stack web',
    environment: 'APP',
    items: [{ id: 'i1', label: 'lodash', query: 'lodash' }],
  };

  it('returns candidates when CVE matches profile and severity', () => {
    const cves = [
      {
        id: 'CVE-1',
        cveId: 'CVE-2024-1',
        title: 'lodash issue',
        description: 'lodash',
        severity: 'HIGH',
        cvssScore: 8,
        epssScore: null,
        epssPercentile: null,
        isKev: false,
        kevRansomware: false,
        sources: ['osv'],
        affectedPackages: [{ name: 'lodash', ecosystem: 'npm' }],
        rawNvd: null,
        modifiedAt: new Date(),
        createdAt: new Date(),
      },
    ];

    const settings = parseVulnMonitorSettings({ profileIds: ['p1'] });
    const candidates = findVulnAlertCandidates(cves, settings, [profile]);
    expect(candidates).toHaveLength(1);
  });

  it('skips when no profileIds configured', () => {
    const settings = parseVulnMonitorSettings({});
    const candidates = findVulnAlertCandidates([], settings, [profile]);
    expect(candidates).toHaveLength(0);
  });
});
