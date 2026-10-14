import { readFileSync } from 'fs';
import { join } from 'path';
import {
  evaluateVulnSubscription,
  passesSeverityGate,
} from './vuln-alert-filter';
import type {
  ProfileInput,
  VulnMonitorSettingsInput,
} from './vuln-alert.types';

function loadFixture(name: string) {
  return JSON.parse(
    readFileSync(
      join(__dirname, '../../../../test/fixtures/cves', name),
      'utf8',
    ),
  );
}

const profile: ProfileInput = {
  id: 'p1',
  name: 'Stack web',
  items: [{ id: 'i1', label: 'lodash', query: 'lodash' }],
};

const baseSettings: VulnMonitorSettingsInput = {
  profileIds: ['p1'],
  severities: ['CRITICAL', 'HIGH'],
  keywords: [],
};

describe('vuln-alert-filter', () => {
  it('passes HIGH lodash CVE with profile match', () => {
    const cve = loadFixture('npm-lodash.json');
    const result = evaluateVulnSubscription(cve, baseSettings, [profile]);
    expect(result.pass).toBe(true);
    expect(result.hits.length).toBeGreaterThan(0);
  });

  it('rejects MEDIUM severity by default', () => {
    const cve = { ...loadFixture('npm-lodash.json'), severity: 'MEDIUM' };
    expect(passesSeverityGate(cve, baseSettings)).toBe(false);
  });

  it('requires keyword when configured', () => {
    const cve = loadFixture('npm-lodash.json');
    const settings = { ...baseSettings, keywords: ['nonexistent'] };
    const result = evaluateVulnSubscription(cve, settings, [profile]);
    expect(result.pass).toBe(false);
  });

  it('rejects CVE without profile match', () => {
    const cve = loadFixture('nvd-siemens-cpe.json');
    const result = evaluateVulnSubscription(cve, baseSettings, [profile]);
    expect(result.pass).toBe(false);
  });
});

describe('vuln-alert-filter — KEV and unrated CVEs', () => {
  const unrated = {
    id: 'CVE-2024-9999',
    cveId: 'CVE-2024-9999',
    title: 'Acme - Widget Server',
    description: 'lodash prototype pollution in the bundled runtime',
    severity: null,
    sources: ['kev'],
  };

  it('rejects an unrated CVE that is not in KEV', () => {
    expect(passesSeverityGate({ ...unrated, isKev: false }, baseSettings)).toBe(
      false,
    );
  });

  it('accepts an unrated KEV CVE regardless of the severity list', () => {
    expect(passesSeverityGate({ ...unrated, isKev: true }, baseSettings)).toBe(
      true,
    );
  });

  it('accepts a KEV CVE whose severity is below the configured list', () => {
    expect(
      passesSeverityGate(
        { ...unrated, isKev: true, severity: 'LOW' },
        baseSettings,
      ),
    ).toBe(true);
  });

  it('still blocks a non-KEV CVE below the threshold', () => {
    expect(
      passesSeverityGate(
        { ...unrated, isKev: false, severity: 'LOW' },
        baseSettings,
      ),
    ).toBe(false);
  });

  it('still applies isKevOnly to a non-KEV CVE', () => {
    const settings = { ...baseSettings, isKevOnly: true };
    expect(
      passesSeverityGate(
        { ...unrated, isKev: false, severity: 'CRITICAL' },
        settings,
      ),
    ).toBe(false);
  });

  it('still applies cvssMin to a KEV CVE that has a score', () => {
    const settings = { ...baseSettings, cvssMin: 9 };
    expect(
      passesSeverityGate({ ...unrated, isKev: true, cvssScore: 5 }, settings),
    ).toBe(false);
  });

  it('still applies epssMin to a KEV CVE that has a score', () => {
    const settings = { ...baseSettings, epssMin: 0.5 };
    expect(
      passesSeverityGate({ ...unrated, isKev: true, epssScore: 0.1 }, settings),
    ).toBe(false);
  });

  it('still applies the source filter to a KEV CVE', () => {
    const settings = { ...baseSettings, sources: ['nvd'] };
    expect(passesSeverityGate({ ...unrated, isKev: true }, settings)).toBe(
      false,
    );
  });

  it('still requires a profile match for a KEV CVE', () => {
    const noMatch = { ...unrated, isKev: true, description: 'unrelated' };
    expect(
      evaluateVulnSubscription(noMatch, baseSettings, [profile]).pass,
    ).toBe(false);
  });

  it('surfaces a matching KEV CVE end to end', () => {
    const result = evaluateVulnSubscription(
      { ...unrated, isKev: true },
      baseSettings,
      [profile],
    );
    expect(result.pass).toBe(true);
    expect(result.hits[0].itemLabel).toBe('lodash');
  });
});
