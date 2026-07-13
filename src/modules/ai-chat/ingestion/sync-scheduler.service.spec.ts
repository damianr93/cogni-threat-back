import { SyncSchedulerService } from './sync-scheduler.service';

describe('Ai chat SyncSchedulerService', () => {
  it('does not start scheduled embedding sync while manual pause is enabled', async () => {
    const ingestion = { ingestAll: jest.fn() };
    const control = {
      getStatus: jest.fn().mockReturnValue({ manualPaused: true }),
    };
    const service = new SyncSchedulerService(ingestion as never, control as never);

    await service.syncAll();

    expect(ingestion.ingestAll).not.toHaveBeenCalled();
  });

  it('starts scheduled embedding sync when not manually paused', async () => {
    const ingestion = { ingestAll: jest.fn().mockResolvedValue(undefined) };
    const control = {
      getStatus: jest.fn().mockReturnValue({ manualPaused: false }),
    };
    const service = new SyncSchedulerService(ingestion as never, control as never);

    await service.syncAll();

    expect(ingestion.ingestAll).toHaveBeenCalledTimes(1);
  });
});
