import { GroupsSyncProgressService } from './groups-sync-progress.service';

describe('GroupsSyncProgressService', () => {
  let service: GroupsSyncProgressService;

  beforeEach(() => {
    service = new GroupsSyncProgressService();
  });

  it('starts idle', () => {
    expect(service.getStatus()).toMatchObject({ status: 'idle', total: 0, processed: 0 });
  });

  it('tracks progress while running', () => {
    service.start(385);
    service.update({ processed: 12, successCount: 10, errorCount: 2 });

    expect(service.getStatus()).toMatchObject({
      status: 'running',
      total: 385,
      processed: 12,
      successCount: 10,
      errorCount: 2,
    });
    expect(service.isRunning()).toBe(true);
  });

  it('completes with message', () => {
    service.start(10);
    service.complete('Synced 10 groups');

    expect(service.getStatus()).toMatchObject({
      status: 'completed',
      processed: 10,
      message: 'Synced 10 groups',
    });
    expect(service.isRunning()).toBe(false);
  });

  it('marks failure', () => {
    service.start(10);
    service.fail('API down');

    expect(service.getStatus()).toMatchObject({ status: 'failed', message: 'API down' });
  });

  it('reset returns to idle', () => {
    service.start(5);
    service.reset();
    expect(service.getStatus().status).toBe('idle');
  });
});
