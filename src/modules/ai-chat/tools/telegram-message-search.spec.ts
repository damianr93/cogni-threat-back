import { Prisma } from '@prisma/client';
import { searchTelegramMessages } from './telegram-message-search';

const row = (content: string, day = '2026-03-02') => ({
  channelName: 'chan',
  content,
  date: new Date(`${day}T10:00:00Z`),
});

function setup() {
  const tx = {
    $executeRawUnsafe: jest.fn().mockResolvedValue(1),
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const prisma = {
    $transaction: jest.fn((work: (t: unknown) => unknown) => work(tx)),
  };
  const search = (p: Parameters<typeof searchTelegramMessages>[1]) =>
    searchTelegramMessages(prisma as never, p);
  const sql = (call: number) => tx.$queryRaw.mock.calls[call][0] as Prisma.Sql;
  /** FTS (rows, count) then optional fallback (rows, count). */
  const respond = (...answers: unknown[]) =>
    answers.forEach((a) =>
      a instanceof Error
        ? tx.$queryRaw.mockRejectedValueOnce(a)
        : tx.$queryRaw.mockResolvedValueOnce(a),
    );
  return { tx, prisma, search, sql, respond };
}

const base = { limit: 10 };
const timeout = () =>
  Object.assign(new Error('canceling statement'), { meta: { code: '57014' } });

describe('searchTelegramMessages: full-text search', () => {
  it('ORs the simple and spanish tsvector expressions that the indexes use', async () => {
    const { tx, search, sql, respond } = setup();
    respond([row('LockBit attack')], [{ total: 1 }]);

    const out = await search({ ...base, query: 'lockbit "x" -y' });

    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SET LOCAL statement_timeout = 8000',
    );
    const q = sql(0);
    expect(q.sql).toContain("to_tsvector('simple', content) @@");
    expect(q.sql).toContain("to_tsvector('spanish', content) @@");
    expect(q.sql).toContain(' OR ');
    expect(q.sql).toContain("websearch_to_tsquery('simple', ");
    expect(q.sql).toContain("websearch_to_tsquery('spanish', ");
    expect(q.sql).toContain('ORDER BY date DESC');
    expect(q.values).toEqual(['lockbit "x" -y', 'lockbit "x" -y', 10]);
    expect(out).toEqual({
      items: [{ channel: 'chan', date: '2026-03-02', text: 'LockBit attack' }],
      total: 1,
      usedFallback: false,
    });
  });

  it('caps the total with a bounded subquery', async () => {
    const { search, sql, respond } = setup();
    respond([row('a')], [{ total: 1000 }]);

    const out = await search({ ...base, query: 'a' });

    expect(sql(1).sql).toMatch(/count\(\*\).*LIMIT 1000/s);
    expect(out).toMatchObject({ total: 1000 });
  });

  it('ORs keywords with plainto_tsquery and ANDs them with the query', async () => {
    const { search, sql, respond } = setup();
    respond([row('a')], [{ total: 1 }]);

    await search({ ...base, query: 'q', keywords: ['k1', 'k2'] });

    const q = sql(0);
    expect(q.sql).toContain("plainto_tsquery('simple', ");
    expect(q.sql).toContain(' && ');
    expect(q.sql).toContain(' || ');
    expect(q.values).toEqual(['q', 'k1', 'k2', 'q', 'k1', 'k2', 10]);
  });

  it('adds channel and date filters as bound values', async () => {
    const { search, sql, respond } = setup();
    respond([row('a')], [{ total: 1 }]);
    const since = new Date('2026-01-01');
    const until = new Date('2026-02-01');

    await search({ ...base, query: 'q', channel: 'ch', since, until });

    const q = sql(0);
    expect(q.sql).toContain('"channelName" = ');
    expect(q.sql).toContain('date >= ');
    expect(q.sql).toContain('date <= ');
    expect(q.values).toEqual(['q', 'q', 'ch', since, until, 10]);
  });

  it('lists a channel without any text term and never falls back', async () => {
    const { tx, search, sql, respond } = setup();
    respond([], [{ total: 0 }]);

    const out = await search({ ...base, channel: 'ch' });

    expect(sql(0).sql).not.toContain('tsquery');
    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ items: [], total: 0, usedFallback: false });
  });

  it('truncates long message text', async () => {
    const { search, respond } = setup();
    respond([row('x'.repeat(900))], [{ total: 1 }]);

    const out = (await search({ ...base, query: 'x' })) as {
      items: { text: string }[];
    };

    expect(out.items[0].text).toBe('x'.repeat(400) + '…');
  });
});

describe('searchTelegramMessages: trigram fallback', () => {
  it('falls back to an escaped ILIKE when FTS has zero hits', async () => {
    const { tx, search, sql, respond } = setup();
    respond([], [{ total: 0 }], [row('LockBit_3.0 50% off')], [{ total: 1 }]);

    const out = await search({ ...base, query: 'lock_b 50%' });

    const q = sql(2);
    expect(q.sql).toContain("content ILIKE ? ESCAPE '!'");
    expect(q.sql).not.toContain('tsquery');
    expect(q.sql).toContain('ORDER BY date DESC');
    expect(q.values).toEqual(['%lock!_b%', '%50!%%', 10]);
    expect(tx.$executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(out).toMatchObject({ usedFallback: true, total: 1 });
  });

  it('ANDs query tokens, ORs keywords, strips operators and applies filters', async () => {
    const { search, sql, respond } = setup();
    respond([], [{ total: 0 }], [], [{ total: 0 }]);

    await search({
      ...base,
      query: '"ab" -cd!',
      keywords: ['k1', 'k2'],
      channel: 'ch',
    });

    const q = sql(2);
    expect(q.sql).toMatch(
      /\(content ILIKE \? ESCAPE '!' AND content ILIKE \? ESCAPE '!'\) AND \(content ILIKE \? ESCAPE '!' OR content ILIKE \? ESCAPE '!'\)/,
    );
    expect(q.values).toEqual(['%ab%', '%cd!!%', '%k1%', '%k2%', 'ch', 10]);
  });

  it('falls back when FTS errors', async () => {
    const { search, respond } = setup();
    respond(new Error('syntax error in tsquery'), [row('a')], [{ total: 1 }]);

    expect(await search({ ...base, query: 'a' })).toMatchObject({
      usedFallback: true,
      total: 1,
    });
  });

  it('returns an empty list, not an error, when both are empty', async () => {
    const { search, respond } = setup();
    respond([], [{ total: 0 }], [], [{ total: 0 }]);

    expect(await search({ ...base, query: 'zzz' })).toEqual({
      items: [],
      total: 0,
      usedFallback: true,
    });
  });

  it('returns nothing when the text has no usable token', async () => {
    const { tx, search, respond } = setup();
    respond([], [{ total: 0 }]);

    const out = await search({ ...base, query: '"" -' });

    expect(tx.$queryRaw).toHaveBeenCalledTimes(2);
    expect(out).toEqual({ items: [], total: 0, usedFallback: true });
  });

  it('returns { error } when the fallback times out', async () => {
    const { search, respond } = setup();
    respond([], [{ total: 0 }], timeout());

    expect(await search({ ...base, query: 'lockb' })).toEqual({
      error: expect.stringMatching(/timed out after 8000 ms/),
    });
  });

  it('returns { error } when FTS times out, without a second scan', async () => {
    const { tx, search, respond } = setup();
    respond(timeout());

    expect(await search({ ...base, query: 'lockbit' })).toEqual({
      error: expect.stringMatching(/timed out after 8000 ms/),
    });
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
  });
});
