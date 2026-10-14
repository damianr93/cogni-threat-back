import { Prisma } from '@prisma/client';
import { createCveTools } from './cve.tools';
import { jsonSchemaMismatches } from './schema-parity';
import { ToolRegistry } from './tool-registry';

const D = (n: number) => new Prisma.Decimal(n);

function setup() {
  const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(1) };
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
  };
  const cves = {
    searchForChat: jest
      .fn()
      .mockResolvedValue({ total: 0, productCapped: false, data: [] }),
    findById: jest.fn().mockResolvedValue(null),
    getStats: jest.fn().mockResolvedValue({
      total: 10,
      kevCount: 2,
      newLast24h: 1,
      bySeverity: { HIGH: 4 },
    }),
  };
  const tools = createCveTools({ cves, prisma } as never);
  const registry = new ToolRegistry(tools);
  const run = (name: string, args: Record<string, unknown>) =>
    registry.execute({ name, arguments: args }, {});
  return { tx, prisma, cves, tools, run };
}

const row = {
  id: 'CVE-2024-3400',
  cveId: 'CVE-2024-3400',
  title: 'PAN-OS command injection',
  description: 'x'.repeat(500),
  severity: 'CRITICAL',
  cvssScore: D(10),
  epssScore: D(0.94),
  epssPercentile: D(0.99),
  isKev: true,
  kevRansomware: false,
  publishedAt: new Date('2024-04-12T00:00:00Z'),
  modifiedAt: new Date('2024-05-01T00:00:00Z'),
};

describe('CVE tools', () => {
  it('exposes exactly the three read-only CVE tools with lean English descriptions', () => {
    const { tools } = setup();

    expect(tools.map((t) => t.name)).toEqual([
      'search_cves',
      'get_cve',
      'cve_stats',
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeLessThanOrEqual(200);
      expect(jsonSchemaMismatches(tool)).toEqual([]);
    }
  });

  describe('search_cves', () => {
    it('runs the search on the timeout transaction client with mapped filters', async () => {
      const { tx, prisma, cves, run } = setup();

      await run('search_cves', {
        query: 'fortinet',
        severity: 'high',
        isKev: 'true',
        minCvss: '7.5',
        since: '2024-01-01',
        sort: 'cvss',
        limit: 5,
      });

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 5000',
      );
      expect(cves.searchForChat).toHaveBeenCalledWith(
        {
          query: 'fortinet',
          severity: 'HIGH',
          isKev: true,
          minCvss: 7.5,
          minEpss: undefined,
          product: undefined,
          publishedSince: new Date('2024-01-01'),
          sort: 'cvss',
          limit: 5,
        },
        tx,
      );
    });

    it('clamps limit to 25 and defaults to 10', async () => {
      const { cves, run } = setup();

      await run('search_cves', { limit: 500 });
      await run('search_cves', {});

      expect(cves.searchForChat.mock.calls[0][0].limit).toBe(25);
      expect(cves.searchForChat.mock.calls[1][0].limit).toBe(10);
    });

    it.each([
      ['non-numeric limit', { limit: 'abc' }],
      ['unknown severity', { severity: 'EXTREME' }],
      ['CVSS above 10', { minCvss: 11 }],
      ['EPSS above 1', { minEpss: 2 }],
      ['invalid date', { since: 'yesterday' }],
      ['over-long query', { query: 'a'.repeat(201) }],
    ])('rejects %s without running a query', async (_label, args) => {
      const { prisma, run } = setup();

      const result = await run('search_cves', args);

      expect(result).toEqual({ error: expect.stringMatching(/invalid/i) });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps rows to compact items with numeric scores and a total', async () => {
      const { cves, run } = setup();
      cves.searchForChat.mockResolvedValue({
        total: 31,
        productCapped: false,
        data: [row],
      });

      const result = await run('search_cves', {});

      expect(result).toEqual({
        total: 31,
        items: [
          {
            id: 'CVE-2024-3400',
            title: 'PAN-OS command injection',
            severity: 'CRITICAL',
            cvss: 10,
            epss: 0.94,
            kev: true,
            published: '2024-04-12',
            description: 'x'.repeat(160) + '…',
          },
        ],
      });
    });

    it('notes when the product scan hit its cap', async () => {
      const { cves, run } = setup();
      cves.searchForChat.mockResolvedValue({
        total: 1,
        productCapped: true,
        data: [row],
      });

      const result = await run('search_cves', { product: 'openssl' });

      expect(result).toMatchObject({
        note: expect.stringMatching(/500 most recently modified/),
      });
    });

    it('returns { error } when the statement times out', async () => {
      const { prisma, run } = setup();
      prisma.$transaction.mockRejectedValue(
        Object.assign(new Error('canceling statement'), {
          meta: { code: '57014' },
        }),
      );

      const result = await run('search_cves', { query: 'a' });

      expect(result).toEqual({
        error: expect.stringMatching(/timed out after 5000 ms/),
      });
    });
  });

  describe('get_cve', () => {
    it.each(['CVE-1', 'CVE-2024-12', "x'; DROP TABLE vuln_cves;--", ''])(
      'rejects the malformed id %p without a lookup',
      async (cveId) => {
        const { cves, run } = setup();

        const result = await run('get_cve', { cveId });

        expect(result).toEqual({ error: expect.stringMatching(/invalid/i) });
        expect(cves.findById).not.toHaveBeenCalled();
      },
    );

    it('looks the id up upper-cased and reports a miss', async () => {
      const { cves, run } = setup();

      const result = await run('get_cve', { cveId: ' cve-2024-3400 ' });

      expect(cves.findById).toHaveBeenCalledWith('CVE-2024-3400');
      expect(result).toEqual({ found: false, cveId: 'CVE-2024-3400' });
    });

    it('returns the detail with the current EPSS and KEV data', async () => {
      const { cves, run } = setup();
      cves.findById.mockResolvedValue({
        ...row,
        cvssVector: 'CVSS:3.1/AV:N',
        cvssVersion: '3.1',
        kevDate: new Date('2024-04-12T00:00:00Z'),
        kevDueDate: new Date('2024-04-19T00:00:00Z'),
        sources: ['nvd', 'kev'],
        affectedPackages: [
          { vendor: 'paloalto', product: 'pan-os' },
          { name: 'libfoo' },
        ],
        references: [
          { url: 'https://example.test/a' },
          'https://example.test/b',
        ],
      });

      const result = await run('get_cve', { cveId: 'CVE-2024-3400' });

      expect(result).toMatchObject({
        found: true,
        id: 'CVE-2024-3400',
        cvss: 10,
        cvssVector: 'CVSS:3.1/AV:N',
        epss: 0.94,
        epssPercentile: 0.99,
        kev: true,
        kevDueDate: '2024-04-19',
        affectedProducts: ['paloalto/pan-os', 'libfoo'],
        affectedProductsTotal: 2,
        references: ['https://example.test/a', 'https://example.test/b'],
      });
    });
  });

  describe('cve_stats', () => {
    it('returns the global counts, read on the timeout transaction client', async () => {
      const { tx, cves, run } = setup();

      const result = await run('cve_stats', {});

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 5000',
      );
      expect(cves.getStats).toHaveBeenCalledWith(tx);
      expect(result).toEqual({
        total: 10,
        kevCount: 2,
        newLast24h: 1,
        bySeverity: { HIGH: 4 },
      });
    });
  });
});
