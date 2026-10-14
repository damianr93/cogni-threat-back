import {
  clampResultCap,
  fitResult,
  MAX_RESULT_CHARS,
  MIN_RESULT_CHARS,
} from './fit-result';

const row = (i: number) => ({
  id: `CVE-2024-${1000 + i}`,
  note: 'x'.repeat(80),
});
const rows = (n: number) => Array.from({ length: n }, (_, i) => row(i));

describe('clampResultCap', () => {
  it.each([
    [100, MIN_RESULT_CHARS],
    [1500, 1500],
    [9000, MAX_RESULT_CHARS],
  ])('clamps %d to %d', (input, expected) => {
    expect(clampResultCap(input)).toBe(expected);
  });

  it('falls back to the maximum for non-finite caps', () => {
    expect(clampResultCap(Number.NaN)).toBe(MAX_RESULT_CHARS);
  });
});

describe('fitResult', () => {
  it('returns the same result untouched when it already fits', () => {
    const result = { total: 2, items: rows(2) };
    expect(fitResult(result)).toBe(result);
  });

  it('pops trailing items and flags truncation when over the cap', () => {
    const result = { total: 40, items: rows(40) };
    const fitted = fitResult(result, 1000);

    const items = fitted.items as unknown[];
    expect(JSON.stringify(fitted).length).toBeLessThanOrEqual(1000);
    expect(items.length).toBeGreaterThan(0);
    expect(items.length).toBeLessThan(40);
    expect(items[0]).toEqual(row(0));
    expect(fitted.truncated).toBe(true);
    expect(fitted.total).toBe(40);
    expect(() => JSON.parse(JSON.stringify(fitted))).not.toThrow();
  });

  it('applies the clamped cap, never below 600 chars', () => {
    const fitted = fitResult({ items: rows(40) }, 10);
    const size = JSON.stringify(fitted).length;
    expect(size).toBeLessThanOrEqual(MIN_RESULT_CHARS);
    expect(size).toBeGreaterThan(300);
  });

  it('does not mark results that fit as truncated', () => {
    expect(fitResult({ items: rows(2) })).not.toHaveProperty('truncated');
  });

  it('returns an error when there are no items to drop', () => {
    const fitted = fitResult({ blob: 'y'.repeat(5000) });
    expect(fitted).toEqual({
      error: expect.stringContaining('too large'),
    });
  });

  it('returns an error when the envelope alone exceeds the cap', () => {
    const fitted = fitResult({ meta: 'z'.repeat(3000), items: rows(3) });
    expect(fitted).toEqual({
      error: expect.stringContaining('too large'),
    });
  });
});
