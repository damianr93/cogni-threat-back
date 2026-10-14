import { createRansomwareTools } from './ransomware.tools';
import { jsonSchemaMismatches } from './schema-parity';
import { ToolRegistry } from './tool-registry';

function setup() {
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    ransomwareVictimsData: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ransomwareGroupsData: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
  };
  const tools = createRansomwareTools({ prisma } as never);
  const registry = new ToolRegistry(tools);
  const run = (name: string, args: Record<string, unknown>) =>
    registry.execute({ name, arguments: args }, {});
  return { tx, prisma, tools, run };
}

const victim = {
  ransomwareLiveId: 'abc123',
  victim: 'Acme Corp',
  group: 'lockbit3',
  country: 'US',
  activity: 'Manufacturing',
  website: 'acme.test',
  description: 'd'.repeat(300),
  discovered: new Date('2025-03-02T10:00:00Z'),
  attackDate: new Date('2025-03-01T00:00:00Z'),
};

describe('ransomware tools', () => {
  it('exposes the two read-only tools with lean English descriptions', () => {
    const { tools } = setup();

    expect(tools.map((t) => t.name)).toEqual([
      'search_ransomware_victims',
      'get_ransomware_group',
    ]);
    for (const tool of tools) {
      expect(tool.description.length).toBeLessThanOrEqual(200);
      expect(jsonSchemaMismatches(tool)).toEqual([]);
    }
  });

  describe('search_ransomware_victims', () => {
    it('filters group insensitively, upper-cases country, orders newest first', async () => {
      const { tx, run } = setup();

      await run('search_ransomware_victims', {
        group: 'LockBit3',
        country: 'us',
        industry: 'manufact',
        since: '2025-01-01',
        limit: 5,
      });

      expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
        'SET LOCAL statement_timeout = 5000',
      );
      const where = {
        group: { equals: 'LockBit3', mode: 'insensitive' },
        country: 'US',
        activity: { contains: 'manufact', mode: 'insensitive' },
        discovered: { gte: new Date('2025-01-01') },
      };
      expect(tx.ransomwareVictimsData.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where,
          orderBy: { discovered: 'desc' },
          take: 5,
        }),
      );
      expect(tx.ransomwareVictimsData.count).toHaveBeenCalledWith({ where });
    });

    it('matches free text on victim name or activity, and applies no filter when empty', async () => {
      const { tx, run } = setup();

      await run('search_ransomware_victims', { query: 'acme' });
      await run('search_ransomware_victims', {});

      const calls = tx.ransomwareVictimsData.findMany.mock.calls;
      expect(calls[0][0].where).toEqual({
        OR: [
          { victim: { contains: 'acme', mode: 'insensitive' } },
          { activity: { contains: 'acme', mode: 'insensitive' } },
        ],
      });
      expect(calls[1][0].where).toEqual({});
      expect(calls[1][0].take).toBe(10);
    });

    it('escapes LIKE wildcards and the escape character in text filters', async () => {
      const { tx, run } = setup();

      await run('search_ransomware_victims', { query: '50%_\\x' });

      expect(tx.ransomwareVictimsData.findMany.mock.calls[0][0].where).toEqual({
        OR: [
          { victim: { contains: '50\\%\\_\\\\x', mode: 'insensitive' } },
          { activity: { contains: '50\\%\\_\\\\x', mode: 'insensitive' } },
        ],
      });
    });

    it('escapes wildcards in the case-insensitive group match too', async () => {
      const { tx, run } = setup();

      await run('search_ransomware_victims', { group: 'lock_%' });

      expect(tx.ransomwareVictimsData.findMany.mock.calls[0][0].where).toEqual({
        group: { equals: 'lock\\_\\%', mode: 'insensitive' },
      });
    });

    it('clamps limit to 25', async () => {
      const { tx, run } = setup();

      await run('search_ransomware_victims', { limit: 500 });

      expect(tx.ransomwareVictimsData.findMany.mock.calls[0][0].take).toBe(25);
    });

    it.each([
      ['country not ISO-2', { country: 'USA' }],
      ['non-numeric limit', { limit: 'abc' }],
      ['invalid date', { since: 'soon' }],
      ['over-long group', { group: 'g'.repeat(81) }],
    ])('rejects %s without running a query', async (_label, args) => {
      const { prisma, run } = setup();

      const result = await run('search_ransomware_victims', args);

      expect(result).toEqual({ error: expect.stringMatching(/invalid/i) });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('maps rows to compact items with the live id and a total', async () => {
      const { tx, run } = setup();
      tx.ransomwareVictimsData.findMany.mockResolvedValue([victim]);
      tx.ransomwareVictimsData.count.mockResolvedValue(42);

      const result = await run('search_ransomware_victims', {});

      expect(result).toEqual({
        total: 42,
        items: [
          {
            id: 'abc123',
            victim: 'Acme Corp',
            group: 'lockbit3',
            country: 'US',
            activity: 'Manufacturing',
            website: 'acme.test',
            discovered: '2025-03-02',
            attackDate: '2025-03-01',
          },
        ],
      });
    });

    it('returns { error } when the statement times out', async () => {
      const { prisma, run } = setup();
      prisma.$transaction.mockRejectedValue(
        Object.assign(new Error('canceling statement'), {
          meta: { code: '57014' },
        }),
      );

      const result = await run('search_ransomware_victims', {});

      expect(result).toEqual({
        error: expect.stringMatching(/timed out after 5000 ms/),
      });
    });
  });

  describe('get_ransomware_group', () => {
    const group = {
      group: 'lockbit3',
      altname: 'LockBit 3.0',
      description: 'g'.repeat(900),
      firstseen: new Date('2022-06-01T00:00:00Z'),
      lastseen: new Date('2025-03-02T00:00:00Z'),
      victims: 2000,
      ttps: Array.from({ length: 30 }, (_, i) => `T${i}`),
      vulnerabilities: ['CVE-2023-4966'],
      url: 'http://lb.onion',
    };

    it('looks up by name case-insensitively and returns the 5 latest victims plus a count', async () => {
      const { tx, run } = setup();
      tx.ransomwareGroupsData.findFirst.mockResolvedValueOnce(group);
      tx.ransomwareVictimsData.findMany.mockResolvedValue([victim]);
      tx.ransomwareVictimsData.count.mockResolvedValue(1900);

      const result = await run('get_ransomware_group', { name: ' LockBit3 ' });

      expect(tx.ransomwareGroupsData.findFirst).toHaveBeenCalledWith({
        where: { group: { equals: 'LockBit3', mode: 'insensitive' } },
      });
      const victimWhere = {
        group: { equals: 'lockbit3', mode: 'insensitive' },
      };
      expect(tx.ransomwareVictimsData.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: victimWhere,
          orderBy: { discovered: 'desc' },
          take: 5,
        }),
      );
      expect(result).toMatchObject({
        found: true,
        group: 'lockbit3',
        altname: 'LockBit 3.0',
        firstseen: '2022-06-01',
        lastseen: '2025-03-02',
        victimsTotal: 1900,
        ttps: Array.from({ length: 15 }, (_, i) => `T${i}`),
        latestVictims: [
          { id: 'abc123', victim: 'Acme Corp', discovered: '2025-03-02' },
        ],
      });
      expect((result as { description: string }).description).toHaveLength(401);
    });

    it('falls back to the alternative name and reports a miss', async () => {
      const { tx, run } = setup();
      tx.ransomwareGroupsData.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(group);

      await run('get_ransomware_group', { name: 'lockbit 3.0' });
      expect(tx.ransomwareGroupsData.findFirst.mock.calls[1][0]).toEqual({
        where: { altname: { contains: 'lockbit 3.0', mode: 'insensitive' } },
      });

      tx.ransomwareGroupsData.findFirst.mockResolvedValue(null);
      expect(await run('get_ransomware_group', { name: 'nobody' })).toEqual({
        found: false,
        name: 'nobody',
      });
    });

    it.each([[''], ['n'.repeat(81)]])(
      'rejects the name %p without a lookup',
      async (name) => {
        const { prisma, run } = setup();

        const result = await run('get_ransomware_group', { name });

        expect(result).toEqual({ error: expect.stringMatching(/invalid/i) });
        expect(prisma.$transaction).not.toHaveBeenCalled();
      },
    );
  });
});
