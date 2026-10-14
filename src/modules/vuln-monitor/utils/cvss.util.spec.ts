import { parseCvssVector, severityFromScore } from './cvss.util';

describe('parseCvssVector', () => {
  describe('CVSS 3.1', () => {
    it.each([
      [
        'unchanged scope, all high',
        'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        9.8,
      ],
      [
        'changed scope, all high (capped at 10)',
        'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:C/C:H/I:H/A:H',
        10,
      ],
      [
        'changed scope, medium (XSS-like)',
        'CVSS:3.1/AV:N/AC:L/PR:L/UI:R/S:C/C:L/I:L/A:N',
        5.4,
      ],
      [
        'unchanged scope, low impact',
        'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N',
        1.8,
      ],
      [
        'unchanged scope, low CIA',
        'CVSS:3.1/AV:N/AC:L/PR:L/UI:N/S:U/C:L/I:L/A:L',
        6.3,
      ],
      ['no impact', 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:N', 0],
    ])('scores %s', (_label, vector, expected) => {
      expect(parseCvssVector(vector)).toEqual({
        version: '3.1',
        score: expected,
      });
    });
  });

  describe('CVSS 3.0', () => {
    it.each([
      [
        'changed scope reflected XSS',
        'CVSS:3.0/AV:N/AC:L/PR:N/UI:R/S:C/C:L/I:L/A:N',
        6.1,
      ],
      [
        'unchanged scope, all high',
        'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H',
        9.8,
      ],
    ])('scores %s', (_label, vector, expected) => {
      expect(parseCvssVector(vector)).toEqual({
        version: '3.0',
        score: expected,
      });
    });
  });

  describe('CVSS 2.0', () => {
    it.each([
      ['partial impact', 'AV:N/AC:L/Au:N/C:P/I:P/A:P', 7.5],
      ['complete impact', 'AV:N/AC:L/Au:N/C:C/I:C/A:C', 10],
      ['medium complexity, integrity only', 'AV:N/AC:M/Au:N/C:N/I:P/A:N', 4.3],
      ['no impact', 'AV:N/AC:L/Au:N/C:N/I:N/A:N', 0],
    ])('scores %s', (_label, vector, expected) => {
      expect(parseCvssVector(vector)).toEqual({
        version: '2.0',
        score: expected,
      });
    });
  });

  describe('CVSS 4.0', () => {
    it('recognises the version but does not score it', () => {
      const vector =
        'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';
      expect(parseCvssVector(vector)).toEqual({ version: '4.0', score: null });
    });
  });

  describe('invalid input', () => {
    it.each([
      ['null', null],
      ['undefined', undefined],
      ['empty string', ''],
      ['whitespace', '   '],
      ['free text', 'not a vector'],
      ['unknown prefix', 'CVSS:9.9/AV:N'],
    ])('returns null version and score for %s', (_label, vector) => {
      expect(parseCvssVector(vector)).toEqual({ version: null, score: null });
    });

    it('keeps the version but gives a null score for a 3.1 vector with a missing metric', () => {
      expect(
        parseCvssVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H'),
      ).toEqual({
        version: '3.1',
        score: null,
      });
    });

    it('gives a null score for an unknown metric value', () => {
      expect(
        parseCvssVector('CVSS:3.1/AV:X/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H'),
      ).toEqual({
        version: '3.1',
        score: null,
      });
    });

    it('gives a null score for an unknown scope', () => {
      expect(
        parseCvssVector('CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:Z/C:H/I:H/A:H'),
      ).toEqual({
        version: '3.1',
        score: null,
      });
    });
  });
});

describe('severityFromScore', () => {
  it.each([
    [10, '3.1', 'CRITICAL'],
    [9, '3.1', 'CRITICAL'],
    [8.9, '3.1', 'HIGH'],
    [7, '3.0', 'HIGH'],
    [6.9, '3.1', 'MEDIUM'],
    [4, '3.1', 'MEDIUM'],
    [3.9, '3.1', 'LOW'],
    [0.1, '3.1', 'LOW'],
    [0, '3.1', 'NONE'],
  ])('maps %s (v%s) to %s', (score, version, expected) => {
    expect(severityFromScore(score, version)).toBe(expected);
  });

  it('has no CRITICAL band for CVSS 2.0', () => {
    expect(severityFromScore(10, '2.0')).toBe('HIGH');
    expect(severityFromScore(7, '2.0')).toBe('HIGH');
    expect(severityFromScore(4, '2.0')).toBe('MEDIUM');
    expect(severityFromScore(3.9, '2.0')).toBe('LOW');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['NaN', NaN],
  ])('returns null for a %s score', (_label, score) => {
    expect(severityFromScore(score, '3.1')).toBeNull();
  });
});
