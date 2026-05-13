import { Logger } from '@nestjs/common';
import { DataSourcesService } from './data-sources.service';
import { GroupsSyncProgressService } from './groups-sync-progress.service';

describe('DataSourcesService groups sync', () => {
  const dataSource = { id: 'ds-1', name: 'ransomware-live' };

  function makeService(opts: {
    syncGroupsDataResult?: { success: boolean; message?: string; stats?: object; error?: string };
    syncGroupsDataError?: Error;
    dataSource?: typeof dataSource | null;
  } = {}) {
    const ransomwareService = {
      syncGroupsData: opts.syncGroupsDataError
        ? jest.fn().mockRejectedValue(opts.syncGroupsDataError)
        : jest.fn().mockResolvedValue(
            opts.syncGroupsDataResult ?? { success: true, message: 'Groups synced', stats: { count: 5 } },
          ),
      syncData: jest.fn(),
    };

    const prisma = {
      dataSource: {
        findFirst: jest.fn().mockResolvedValue(
          opts.dataSource === null ? null : (opts.dataSource ?? dataSource),
        ),
        update: jest.fn().mockResolvedValue(dataSource),
      },
    };

    const groupsSyncProgress = new GroupsSyncProgressService();
    const service = new DataSourcesService(prisma as never, ransomwareService as never, groupsSyncProgress);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);

    return { service, ransomwareService, prisma, groupsSyncProgress };
  }

  it('syncGroups awaits syncGroupsData and updates lastSync', async () => {
    const { service, ransomwareService, prisma } = makeService();

    const result = await service.syncGroups();

    expect(ransomwareService.syncGroupsData).toHaveBeenCalledWith(undefined);
    expect(prisma.dataSource.update).toHaveBeenCalledWith({
      where: { id: dataSource.id },
      data: { lastSync: expect.any(Date) },
    });
    expect(result).toMatchObject({ success: true, message: 'Groups synced' });
  });

  it('triggerGroupsSyncInBackground returns immediately with started true', async () => {
    const { service, ransomwareService } = makeService();
    let resolved = false;
    ransomwareService.syncGroupsData.mockImplementation(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolved = true;
            resolve({ success: true, message: 'done' });
          }, 50);
        }),
    );

    const result = service.triggerGroupsSyncInBackground();

    expect(result).toEqual({
      started: true,
      message: 'Sincronización de grupos iniciada',
    });
    expect(resolved).toBe(false);
    expect(ransomwareService.syncGroupsData).toHaveBeenCalledTimes(1);

    await new Promise((r) => setTimeout(r, 80));
    expect(resolved).toBe(true);
  });

  it('triggerGroupsSyncInBackground tracks progress callbacks', async () => {
    const { service, ransomwareService, groupsSyncProgress } = makeService();
    ransomwareService.syncGroupsData.mockImplementation(async (options) => {
      options?.onStart?.(3);
      options?.onProgress?.({ processed: 1, successCount: 1, errorCount: 0 });
      options?.onProgress?.({ processed: 3, successCount: 3, errorCount: 0 });
      return { success: true, message: 'Synced 3 groups', stats: {} };
    });

    service.triggerGroupsSyncInBackground();
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(groupsSyncProgress.getStatus()).toMatchObject({
      status: 'completed',
      total: 3,
      processed: 3,
      successCount: 3,
    });
  });

  it('triggerGroupsSyncInBackground handles sync errors without throwing', async () => {
    const { service, ransomwareService, groupsSyncProgress } = makeService({
      syncGroupsDataError: new Error('network failure'),
    });
    const loggerSpy = jest.spyOn(Logger.prototype, 'error');

    expect(() => service.triggerGroupsSyncInBackground()).not.toThrow();

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(loggerSpy).toHaveBeenCalledWith('Error during groups sync: Operation failed');
    expect(groupsSyncProgress.getStatus().status).toBe('failed');
    expect(ransomwareService.syncGroupsData).toHaveBeenCalledTimes(1);
  });

  it('triggerGroupsSyncInBackground rejects concurrent calls while in flight', async () => {
    const { service, ransomwareService } = makeService();
    let resolveSync!: (value: unknown) => void;
    ransomwareService.syncGroupsData.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    const first = service.triggerGroupsSyncInBackground();
    const second = service.triggerGroupsSyncInBackground();

    expect(first.started).toBe(true);
    expect(second).toEqual({
      started: false,
      message: 'Ya hay una sincronización de grupos en curso',
    });
    expect(ransomwareService.syncGroupsData).toHaveBeenCalledTimes(1);

    resolveSync({ success: true, message: 'done' });
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const third = service.triggerGroupsSyncInBackground();
    expect(third.started).toBe(true);
  });

  it('syncGroups returns failure when syncGroupsData fails', async () => {
    const { service } = makeService({
      syncGroupsDataResult: { success: false, error: 'API down' },
    });

    const result = await service.syncGroups();

    expect(result).toMatchObject({ success: false, error: 'API down' });
  });

  it('getGroupsSyncProgress exposes snapshot', () => {
    const { service, groupsSyncProgress } = makeService();
    groupsSyncProgress.start(10);
    expect(service.getGroupsSyncProgress()).toMatchObject({ status: 'running', total: 10 });
  });
});
