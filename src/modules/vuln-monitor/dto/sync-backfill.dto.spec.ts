import { SyncBackfillSchema, parseBackfillDates } from '../dto/sync-backfill.dto';

describe('SyncBackfillSchema', () => {
  it('accepts a valid backfill payload', () => {
    const result = SyncBackfillSchema.safeParse({
      source: 'nvd',
      since: '2024-06-01T00:00:00.000Z',
      until: '2024-06-15T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects when since is not before until', () => {
    const result = SyncBackfillSchema.safeParse({
      source: 'nvd',
      since: '2024-06-15T00:00:00.000Z',
      until: '2024-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('rejects explicit ranges longer than 365 days', () => {
    const result = SyncBackfillSchema.safeParse({
      source: 'osv',
      since: '2023-01-01T00:00:00.000Z',
      until: '2024-06-01T00:00:00.000Z',
    });
    expect(result.success).toBe(false);
  });

  it('allows open-ended backfill without until even beyond 365 days', () => {
    const result = SyncBackfillSchema.safeParse({
      source: 'nvd',
      since: '2023-01-01T00:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('parseBackfillDates defaults until to now', () => {
    const before = Date.now();
    const { since, until } = parseBackfillDates({
      source: 'nvd',
      since: '2024-06-01T00:00:00.000Z',
    });
    expect(since.toISOString()).toBe('2024-06-01T00:00:00.000Z');
    expect(until.getTime()).toBeGreaterThanOrEqual(before);
  });
});
