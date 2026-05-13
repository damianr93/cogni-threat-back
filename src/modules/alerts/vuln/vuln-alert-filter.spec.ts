import { readFileSync } from 'fs';
import { join } from 'path';
import { evaluateVulnSubscription, passesSeverityGate } from './vuln-alert-filter';
import type { ProfileInput, VulnMonitorSettingsInput } from './vuln-alert.types';

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(__dirname, '../../../../test/fixtures/cves', name), 'utf8'));
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
