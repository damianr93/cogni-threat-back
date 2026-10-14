import { VulnAlertPreviewService } from './vuln-alert-preview.service';

const profile = {
  id: 'p1',
  name: 'Stack web',
  environment: 'APP',
  items: [
    {
      id: 'i1',
      label: 'lodash',
      query: 'lodash',
      vendor: null,
      product: null,
      ecosystem: null,
    },
  ],
};

function makeCve(index: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `CVE-2024-${index}`,
    cveId: `CVE-2024-${index}`,
    title: 'Unrelated advisory',
    description: 'nothing of interest here',
    isKev: false,
    severity: 'HIGH',
    cvssScore: 8,
    epssScore: null,
    sources: ['nvd'],
    affectedPackages: null,
    rawNvd: null,
    ...overrides,
  };
}

function makePrisma(rows: unknown[]) {
  const findMany = jest.fn(
    async ({ skip = 0, take }: { skip?: number; take: number }) =>
      rows.slice(skip, skip + take),
  );
  return { prisma: { vulnCve: { findMany } }, findMany };
}

function makeService(rows: unknown[]) {
  const { prisma, findMany } = makePrisma(rows);
  const profiles = {
    validateProfileIds: jest.fn().mockResolvedValue([profile]),
  };
  const service = new VulnAlertPreviewService(
    prisma as never,
    profiles as never,
  );
  return { service, findMany };
}

const body = { profileIds: ['p1'], days: 30 };

describe('VulnAlertPreviewService', () => {
  it('reads 600 candidates as 250, 250 and 100 and evaluates all of them', async () => {
    const rows = [
      ...Array.from({ length: 599 }, (_, i) => makeCve(i)),
      makeCve(999, { description: 'lodash prototype pollution' }),
    ];
    const { service, findMany } = makeService(rows);

    const result = await service.preview('u1', body);

    expect(findMany.mock.calls.map(([args]) => [args.skip, args.take])).toEqual(
      [
        [0, 250],
        [250, 250],
        [500, 250],
      ],
    );
    expect(result.scanned).toBe(600);
    expect(result.truncated).toBe(false);
    expect(result.totalMatches).toBe(1);
  });

  it('stops at 5000 candidates and reports the scan as truncated', async () => {
    const rows = Array.from({ length: 9000 }, (_, i) =>
      makeCve(i, { description: 'lodash everywhere' }),
    );
    const { service, findMany } = makeService(rows);

    const result = await service.preview('u1', body);

    expect(findMany).toHaveBeenCalledTimes(20);
    expect(result.scanned).toBe(5000);
    expect(result.truncated).toBe(true);
    expect(result.totalMatches).toBe(5000);
  });

  it('stops querying as soon as the feed is exhausted', async () => {
    const { service, findMany } = makeService([makeCve(1)]);

    const result = await service.preview('u1', body);

    expect(findMany).toHaveBeenCalledTimes(1);
    expect(result.scanned).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it('never selects the raw blobs other than rawNvd', async () => {
    const { service, findMany } = makeService([makeCve(1)]);

    await service.preview('u1', body);

    const { select } = findMany.mock.calls[0][0];
    expect(select.rawOsv).toBeUndefined();
    expect(select.rawKev).toBeUndefined();
    expect(select.rawGithub).toBeUndefined();
    for (const column of [
      'id',
      'cveId',
      'title',
      'description',
      'isKev',
      'severity',
      'cvssScore',
      'epssScore',
      'sources',
      'affectedPackages',
      'rawNvd',
    ]) {
      expect(select[column]).toBe(true);
    }
  });

  it('caps samples at five while counting every match', async () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      makeCve(i, { description: 'lodash issue' }),
    );
    const { service } = makeService(rows);

    const result = await service.preview('u1', body);

    expect(result.totalMatches).toBe(20);
    expect(result.samples).toHaveLength(5);
    expect(result.samples[0].matchedProfiles).toEqual(['Stack web']);
  });
});
