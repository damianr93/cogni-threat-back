import { makeSyncStateRepository } from '@test/helpers/mock-collector-deps';

describe('SyncStateRepository', () => {
  it('markProgress advances watermark without clearing lastError', async () => {
    const { repo, store } = makeSyncStateRepository({
      nvd: { lastError: 'previous failure', errorCount: 2 },
    });
    const watermark = new Date('2024-06-01T00:00:00.000Z');

    await repo.markProgress('nvd', watermark, 'cursor-1');

    const row = store.rows.get('nvd')!;
    expect(row.lastSyncAt).toEqual(watermark);
    expect(row.lastCursor).toBe('cursor-1');
    expect(row.lastError).toBe('previous failure');
    expect(row.errorCount).toBe(2);
  });

  it('markSuccess clears error and sets final watermark', async () => {
    const { repo, store } = makeSyncStateRepository({
      nvd: { lastError: 'failed', errorCount: 1 },
    });
    const watermark = new Date('2024-06-15T00:00:00.000Z');

    await repo.markSuccess('nvd', 42, 'cursor-final', watermark);

    const row = store.rows.get('nvd')!;
    expect(row.lastSyncAt).toEqual(watermark);
    expect(row.lastCount).toBe(42);
    expect(row.lastCursor).toBe('cursor-final');
    expect(row.lastError).toBeNull();
  });

  it('markSuccess defaults watermark to now when omitted', async () => {
    const { repo, store } = makeSyncStateRepository();
    const before = Date.now();
    await repo.markSuccess('nvd', 10);
    const after = Date.now();
    const ts = store.rows.get('nvd')!.lastSyncAt!.getTime();
    expect(ts).toBeGreaterThanOrEqual(before);
    expect(ts).toBeLessThanOrEqual(after);
  });

  it('markError increments errorCount without moving watermark', async () => {
    const { repo, store } = makeSyncStateRepository({
      nvd: { lastSyncAt: new Date('2024-05-01T00:00:00.000Z'), errorCount: 0 },
    });

    await repo.markError('nvd', 'sync failed');

    const row = store.rows.get('nvd')!;
    expect(row.lastSyncAt).toEqual(new Date('2024-05-01T00:00:00.000Z'));
    expect(row.errorCount).toBe(1);
    expect(row.lastError).toBe('sync failed');
  });
});
