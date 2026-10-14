import { Prisma } from '@prisma/client';
import { createActorTools } from './actor.tools';
import { jsonSchemaMismatches } from './schema-parity';
import { ToolRegistry } from './tool-registry';

function setup() {
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
  };
  const tools = createActorTools({ prisma } as never);
  const registry = new ToolRegistry(tools);
  const run = (args: Record<string, unknown>) =>
    registry.execute({ name: 'search_actors', arguments: args }, {});
  const sql = (call: number) => tx.$queryRaw.mock.calls[call][0] as Prisma.Sql;
  return { tx, prisma, tools, run, sql };
}

const actor = {
  id: 'a1',
  name: 'APT29',
  country: 'Russia',
  aliases: ['Cozy Bear', 'The Dukes'],
  description: 'x'.repeat(500),
  identificatedDate: new Date('2008-01-01T00:00:00Z'),
};

describe('search_actors', () => {
  it('is a single read-only tool with a lean English description', () => {
    const { tools } = setup();

    expect(tools.map((t) => t.name)).toEqual(['search_actors']);
    expect(tools[0].description.length).toBeLessThanOrEqual(200);
    expect(jsonSchemaMismatches(tools[0])).toEqual([]);
  });

  it('matches name or any alias with an escaped, parameterised ILIKE', async () => {
    const { tx, run, sql } = setup();

    await run({ query: '100%_a!', country: 'rus', limit: 5 });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SET LOCAL statement_timeout = 5000',
    );
    const q = sql(0);
    expect(q.sql).toContain('FROM actors_data');
    expect(q.sql).toContain('name ILIKE');
    expect(q.sql).toContain('unnest(aliases)');
    expect(q.sql.match(/ESCAPE '!'/g)).toHaveLength(3);
    expect(q.sql).not.toContain('100%');
    expect(q.values).toEqual(['%100!%!_a!!%', '%100!%!_a!!%', '%rus%', 5]);
  });

  it('applies no filter without arguments, defaults to 10 and clamps to 25', async () => {
    const { run, sql } = setup();

    await run({});
    await run({ limit: 500 });

    expect(sql(0).values).toEqual([10]);
    expect(sql(1).values).toEqual([25]);
  });

  it.each([
    ['non-numeric limit', { limit: 'abc' }],
    ['over-long query', { query: 'q'.repeat(101) }],
  ])('rejects %s without running a query', async (_label, args) => {
    const { prisma, run } = setup();

    const result = await run(args);

    expect(result).toEqual({ error: expect.stringMatching(/invalid/i) });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('returns compact actors with their 3 latest hitos, newest first, via one quoted query', async () => {
    const { tx, run, sql } = setup();
    tx.$queryRaw.mockResolvedValueOnce([actor]).mockResolvedValueOnce([
      {
        actorsDataId: 'a1',
        date: new Date('2024-02-03T00:00:00Z'),
        description: 'Breach of a vendor',
        target: 'Microsoft',
      },
    ]);

    const result = await run({ query: 'apt29' });

    const hitos = sql(1);
    expect(hitos.sql).toContain('"actorsDataId"');
    expect(hitos.sql).toContain('ORDER BY date DESC');
    expect(hitos.values).toEqual([['a1'], 3]);
    expect(result).toEqual({
      items: [
        {
          name: 'APT29',
          country: 'Russia',
          aliases: ['Cozy Bear', 'The Dukes'],
          since: '2008-01-01',
          description: 'x'.repeat(300) + '…',
          latestHitos: [
            {
              date: '2024-02-03',
              target: 'Microsoft',
              description: 'Breach of a vendor',
            },
          ],
        },
      ],
    });
  });

  it('skips the hitos query when nothing matched', async () => {
    const { tx, run } = setup();

    const result = await run({ query: 'zzz' });

    expect(result).toEqual({ items: [] });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });

  it('returns { error } when the statement times out', async () => {
    const { prisma, run } = setup();
    prisma.$transaction.mockRejectedValue(
      Object.assign(new Error('canceling statement'), {
        meta: { code: '57014' },
      }),
    );

    expect(await run({})).toEqual({
      error: expect.stringMatching(/timed out after 5000 ms/),
    });
  });
});
