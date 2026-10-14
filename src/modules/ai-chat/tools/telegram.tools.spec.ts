import { createTelegramTools } from './telegram.tools';
import { jsonSchemaMismatches } from './schema-parity';
import { ToolRegistry } from './tool-registry';

function setup() {
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRaw: jest
      .fn()
      .mockResolvedValueOnce([
        { channelName: 'c', content: 'hi', date: new Date('2026-01-02') },
      ])
      .mockResolvedValueOnce([{ total: 1 }]),
  };
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
  };
  const tools = createTelegramTools({ prisma } as never);
  const run = (args: Record<string, unknown>) =>
    new ToolRegistry(tools).execute(
      { name: 'search_telegram_messages', arguments: args },
      {},
    );
  return { tx, prisma, tools, run };
}

describe('search_telegram_messages', () => {
  it('is a single tool with a lean description and a matching JSON schema', () => {
    const { tools } = setup();

    expect(tools.map((t) => t.name)).toEqual(['search_telegram_messages']);
    expect(tools[0].description.length).toBeLessThanOrEqual(200);
    expect(jsonSchemaMismatches(tools[0])).toEqual([]);
  });

  it('returns the search result for a query', async () => {
    const { run } = setup();

    expect(await run({ query: 'ransomware', limit: '500' })).toEqual({
      items: [{ channel: 'c', date: '2026-01-02', text: 'hi' }],
      total: 1,
      usedFallback: false,
    });
  });

  it('coerces a single keyword string and clamps the limit to 25', async () => {
    const { tx, run } = setup();

    await run({ keywords: 'lockbit', limit: 500 });

    const values = (tx.$queryRaw.mock.calls[0][0] as { values: unknown[] })
      .values;
    expect(values).toEqual(['lockbit', 'lockbit', 25]);
  });

  it.each([
    ['nothing to search', {}],
    ['blank query and no keywords', { query: '  ', keywords: [] }],
    ['over-long query', { query: 'q'.repeat(201) }],
    ['too many keywords', { keywords: Array(11).fill('k') }],
    ['bad date', { query: 'q', since: 'nope' }],
  ])('rejects %s without a query', async (_label, args) => {
    const { prisma, run } = setup();

    expect(await run(args)).toEqual({
      error: expect.stringMatching(/invalid/i),
    });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('accepts a channel alone', async () => {
    const { run } = setup();

    expect(await run({ channel: 'c' })).toMatchObject({ usedFallback: false });
  });
});
