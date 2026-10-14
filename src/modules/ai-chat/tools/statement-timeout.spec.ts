import { withStatementTimeout } from './statement-timeout';

function makePrisma() {
  const tx = { $executeRawUnsafe: jest.fn().mockResolvedValue(0) };
  const prisma = {
    $executeRawUnsafe: jest.fn(),
    $transaction: jest.fn((fn: (t: typeof tx) => Promise<unknown>) => fn(tx)),
  };
  return { prisma, tx };
}

describe('withStatementTimeout', () => {
  it('sets a transaction-local timeout, then runs the work on the same tx', async () => {
    const { prisma, tx } = makePrisma();
    const work = jest.fn().mockResolvedValue({ items: [1] });

    const result = await withStatementTimeout(prisma as never, 5000, work);

    expect(result).toEqual({ items: [1] });
    expect(tx.$executeRawUnsafe).toHaveBeenCalledWith(
      'SET LOCAL statement_timeout = 5000',
    );
    expect(work).toHaveBeenCalledWith(tx);
    expect(tx.$executeRawUnsafe.mock.invocationCallOrder[0]).toBeLessThan(
      work.mock.invocationCallOrder[0],
    );
  });

  it('never touches the pooled client outside the transaction (no leak)', async () => {
    const { prisma } = makePrisma();

    await withStatementTimeout(prisma as never, 8000, () =>
      Promise.resolve('ok'),
    );

    expect(prisma.$executeRawUnsafe).not.toHaveBeenCalled();
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });

  it('gives the interactive transaction headroom beyond the statement timeout', async () => {
    const { prisma } = makePrisma();

    await withStatementTimeout(prisma as never, 8000, () =>
      Promise.resolve('ok'),
    );

    const options = prisma.$transaction.mock.calls[0][1] as { timeout: number };
    expect(options.timeout).toBeGreaterThan(8000);
  });

  it.each([
    [
      'postgres message',
      { message: 'canceling statement due to statement timeout' },
    ],
    [
      'sqlstate in meta',
      { message: 'raw query failed', meta: { code: '57014' } },
    ],
  ])('turns a timeout (%s) into { error }', async (_label, err) => {
    const { prisma } = makePrisma();

    const result = await withStatementTimeout(prisma as never, 5000, () =>
      Promise.reject(err),
    );

    expect(result).toEqual({
      error: expect.stringMatching(/timed out after 5000 ms/i),
    });
  });

  it('rethrows non-timeout failures', async () => {
    const { prisma } = makePrisma();

    await expect(
      withStatementTimeout(prisma as never, 5000, () =>
        Promise.reject(new Error('syntax error')),
      ),
    ).rejects.toThrow('syntax error');
  });

  it.each([0, -5, 1.5, Number.NaN])(
    'rejects the invalid timeout %p before opening a transaction',
    async (ms) => {
      const { prisma } = makePrisma();

      await expect(
        withStatementTimeout(prisma as never, ms, () => Promise.resolve(1)),
      ).rejects.toThrow(/positive integer/);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    },
  );
});
