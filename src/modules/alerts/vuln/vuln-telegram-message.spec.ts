import { buildVulnTelegramMessage } from './vuln-telegram-message';

describe('buildVulnTelegramMessage', () => {
  const escapeHtml = (v: string) => v;
  const truncate = (v: string, max: number) => v.slice(0, max);

  it('includes profile hits in message', () => {
    const msg = buildVulnTelegramMessage({
      cveId: 'CVE-2024-1',
      title: 'Test',
      severity: 'HIGH',
      cvssScore: '8.0',
      epssScore: null,
      epssPercentile: null,
      isKev: false,
      sourceBadges: 'OSV',
      hits: [
        {
          profileId: 'p1',
          profileName: 'Stack web',
          environment: 'APP',
          itemId: 'i1',
          itemLabel: 'lodash',
          matchedOn: 'lodash',
        },
      ],
      escapeHtml,
      truncate,
    });

    expect(msg).toContain('Stack web');
    expect(msg).toContain('lodash');
  });
});
