import { readFileSync } from 'fs';
import { join } from 'path';
import { matchCveToProfiles } from './vuln-profile.matcher';
import type { ProfileInput } from './vuln-alert.types';

function loadFixture(name: string) {
  return JSON.parse(readFileSync(join(__dirname, '../../../../test/fixtures/cves', name), 'utf8'));
}

const webProfile: ProfileInput = {
  id: 'profile-web',
  name: 'Stack web prod',
  environment: 'APP',
  items: [
    { id: 'i1', label: 'lodash', query: 'lodash' },
    { id: 'i2', label: 'nginx', query: 'nginx' },
  ],
};

const otProfile: ProfileInput = {
  id: 'profile-ot',
  name: 'Planta OT',
  environment: 'OT',
  items: [
    { id: 'i3', label: 'Siemens S7', query: 's7', vendor: 'siemens', product: 's7-1500' },
  ],
};

describe('matchCveToProfiles', () => {
  it('matches npm lodash CVE to web profile', () => {
    const result = matchCveToProfiles(loadFixture('npm-lodash.json'), [webProfile, otProfile]);
    expect(result.matched).toBe(true);
    expect(result.hits.some((h) => h.profileId === 'profile-web')).toBe(true);
  });

  it('matches PyPI requests with ecosystem filter', () => {
    const cve = loadFixture('pypi-requests.json');
    const pipProfile: ProfileInput = {
      id: 'pip',
      name: 'Python deps',
      items: [{ id: 'r1', label: 'requests', query: 'requests', ecosystem: 'pypi' }],
    };
    const result = matchCveToProfiles(cve, [pipProfile]);
    expect(result.matched).toBe(true);
  });

  it('matches NVD CPE siemens to OT profile', () => {
    const result = matchCveToProfiles(loadFixture('nvd-siemens-cpe.json'), [webProfile, otProfile]);
    expect(result.hits.some((h) => h.profileId === 'profile-ot')).toBe(true);
  });

  it('does not match unrelated CVE to web profile only', () => {
    const result = matchCveToProfiles(loadFixture('nvd-siemens-cpe.json'), [webProfile]);
    expect(result.matched).toBe(false);
  });
});
