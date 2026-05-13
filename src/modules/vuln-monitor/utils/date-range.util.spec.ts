import { NVD_MAX_WINDOW_DAYS, splitDateRange } from './date-range.util';

describe('splitDateRange', () => {
  it('returns a single chunk when range is shorter than maxDays', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-01-10T00:00:00.000Z');
    const chunks = splitDateRange(start, end, 90);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].start).toEqual(start);
    expect(chunks[0].end).toEqual(end);
  });

  it('splits a 200-day range into contiguous non-overlapping chunks', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2024-07-19T00:00:00.000Z');
    const chunks = splitDateRange(start, end, 90);
    expect(chunks).toHaveLength(3);
    expect(chunks[0].start).toEqual(start);
    expect(chunks[chunks.length - 1].end).toEqual(end);
    for (let i = 1; i < chunks.length; i++) {
      expect(chunks[i].start.getTime()).toBeGreaterThan(chunks[i - 1].start.getTime());
      expect(chunks[i].start.getTime()).toBeLessThanOrEqual(chunks[i - 1].end.getTime() + 1);
    }
  });

  it('throws when start is not before end', () => {
    const d = new Date('2024-06-01T00:00:00.000Z');
    expect(() => splitDateRange(d, d)).toThrow('start must be before end');
    expect(() => splitDateRange(d, new Date('2024-05-01T00:00:00.000Z'))).toThrow('start must be before end');
  });

  it('exports NVD_MAX_WINDOW_DAYS as 90', () => {
    expect(NVD_MAX_WINDOW_DAYS).toBe(90);
  });
});
