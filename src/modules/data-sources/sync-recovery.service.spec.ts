import { SyncRecoveryService } from './sync-recovery.service';

describe('SyncRecoveryService', () => {
  const STALE_HOURS = 24;

  function hoursAgo(h: number) {
    return new Date(Date.now() - h * 60 * 60 * 1000);
  }

  function makeService(opts: {
    lastSync?: Date | null;
    onBoot?: boolean;
    dataSource?: { id: string; name: string; lastSync: Date | null } | null;
  } = {}) {
    const dataSources = {
      syncGroups: jest.fn().mockResolvedValue({ success: true }),
      syncVictimsByCountry: jest.fn().mockResolvedValue({ success: true }),
    };

    const prisma = {
      dataSource: {
        findFirst: jest.fn().mockResolvedValue(
          opts.dataSource === null
            ? null
            : (opts.dataSource ?? {
                id: 'ds-1',
                name: 'ransomware-live',
                lastSync: opts.lastSync ?? null,
              }),
        ),
      },
    };

    const service = new SyncRecoveryService(
      prisma as never,
      dataSources as never,
      { onBoot: opts.onBoot ?? true, staleHours: STALE_HOURS },
    );

    return { service, dataSources, prisma };
  }

  it('does not recover when lastSync is recent', async () => {
    const { service, dataSources } = makeService({ lastSync: hoursAgo(2) });
    await service.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(dataSources.syncGroups).not.toHaveBeenCalled();
    expect(dataSources.syncVictimsByCountry).not.toHaveBeenCalled();
  });

  it('recovers when lastSync is older than threshold', async () => {
    const { service, dataSources } = makeService({ lastSync: hoursAgo(48) });
    await service.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(dataSources.syncGroups).toHaveBeenCalled();
    expect(dataSources.syncVictimsByCountry).toHaveBeenCalled();
  });

  it('recovers when lastSync is null', async () => {
    const { service, dataSources } = makeService({ lastSync: null });
    await service.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(dataSources.syncGroups).toHaveBeenCalled();
  });

  it('skips recovery when disabled on boot', async () => {
    const { service, dataSources } = makeService({ lastSync: hoursAgo(48), onBoot: false });
    await service.onModuleInit();
    await new Promise((r) => setImmediate(r));
    expect(dataSources.syncGroups).not.toHaveBeenCalled();
  });

  it('triggerRecovery runs full sync without throwing on errors', async () => {
    const { service, dataSources } = makeService({ lastSync: hoursAgo(2) });
    dataSources.syncGroups.mockRejectedValue(new Error('network'));
    await expect(service.triggerRecovery()).resolves.toEqual({
      started: true,
      message: expect.stringContaining('recovery'),
    });
  });

  it('isStale returns true when lastSync is null', () => {
    const { service } = makeService();
    expect(service.isStale(null)).toBe(true);
  });

  it('isStale returns false for recent sync', () => {
    const { service } = makeService();
    expect(service.isStale(hoursAgo(2))).toBe(false);
  });
});
