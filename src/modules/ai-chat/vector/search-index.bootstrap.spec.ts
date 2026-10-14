import { Logger } from '@nestjs/common';
import { SearchIndexBootstrap } from './search-index.bootstrap';

describe('SearchIndexBootstrap', () => {
  function setup(executeRawUnsafe = jest.fn().mockResolvedValue(0)) {
    const prisma = { $executeRawUnsafe: executeRawUnsafe };
    const bootstrap = new SearchIndexBootstrap(prisma as never);
    return { bootstrap, executeRawUnsafe };
  }

  it('issues CREATE INDEX IF NOT EXISTS for both FTS expression indexes', async () => {
    const { bootstrap, executeRawUnsafe } = setup();

    await bootstrap.onModuleInit();

    const sqls = executeRawUnsafe.mock.calls.map((c) => String(c[0]));
    expect(sqls).toHaveLength(2);
    expect(sqls[0]).toContain(
      'CREATE INDEX IF NOT EXISTS telegram_msg_fts_simple_idx',
    );
    expect(sqls[0]).toContain("USING GIN (to_tsvector('simple', content))");
    expect(sqls[1]).toContain(
      'CREATE INDEX IF NOT EXISTS telegram_msg_fts_spanish_idx',
    );
    expect(sqls[1]).toContain("USING GIN (to_tsvector('spanish', content))");
    for (const sql of sqls) {
      expect(sql).toContain('telegram_channel_messages');
    }
  });

  it('logs and keeps booting when an index cannot be created', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const { bootstrap, executeRawUnsafe } = setup(
      jest
        .fn()
        .mockRejectedValueOnce(new Error('permission denied'))
        .mockResolvedValueOnce(0),
    );

    await expect(bootstrap.onModuleInit()).resolves.toBeUndefined();

    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('permission denied'),
    );
    warn.mockRestore();
  });
});
