import { SyncSchedulerService } from './sync-scheduler.service';

describe('SyncSchedulerService', () => {
  function makeService() {
    const kev = { sync: jest.fn().mockResolvedValue({ source: 'kev' }) };
    const nvd = { sync: jest.fn().mockResolvedValue({ source: 'nvd' }) };
    const github = { sync: jest.fn().mockResolvedValue({ source: 'github' }) };
    const osv = { sync: jest.fn().mockResolvedValue({ source: 'osv' }) };
    const epss = { sync: jest.fn().mockResolvedValue({ source: 'epss' }) };
    const vulnMonitor = { invalidateStatsCache: jest.fn() };

    const service = new SyncSchedulerService(
      kev as never,
      nvd as never,
      github as never,
      osv as never,
      epss as never,
      vulnMonitor as never,
    );

    return { service, kev, nvd, github, osv, vulnMonitor };
  }

  it('triggerBackfill dispatches NVD with since and until', async () => {
    const { service, nvd } = makeService();

    const response = await service.triggerBackfill({
      source: 'nvd',
      since: '2024-06-01T00:00:00.000Z',
      until: '2024-06-15T00:00:00.000Z',
    });

    expect(response.started).toBe(true);
    expect(response.source).toBe('nvd');
    await new Promise((r) => setImmediate(r));
    expect(nvd.sync).toHaveBeenCalledWith(
      new Date('2024-06-01T00:00:00.000Z'),
      new Date('2024-06-15T00:00:00.000Z'),
    );
  });

  it('triggerManualSync invokes four collectors in parallel', async () => {
    const { service, kev, nvd, github, osv } = makeService();

    await service.triggerManualSync();
    await new Promise((r) => setImmediate(r));

    expect(kev.sync).toHaveBeenCalled();
    expect(nvd.sync).toHaveBeenCalled();
    expect(github.sync).toHaveBeenCalled();
    expect(osv.sync).toHaveBeenCalledWith({ maxItems: 500 });
  });

  it('triggerBackfill routes OSV with since date', async () => {
    const { service, osv } = makeService();

    await service.triggerBackfill({
      source: 'osv',
      since: '2024-05-01T00:00:00.000Z',
    });
    await new Promise((r) => setImmediate(r));

    expect(osv.sync).toHaveBeenCalledWith(new Date('2024-05-01T00:00:00.000Z'));
  });
});
