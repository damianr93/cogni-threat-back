import {
  parseBackfillArgs,
  resolveOsvRow,
  runOsvSeverityBackfill,
} from './osv-severity-backfill';

const V31_CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
const V2_MEDIUM = 'AV:N/AC:L/Au:N/C:P/I:P/A:P';
const V4 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

describe('resolveOsvRow', () => {
  it('scores a 3.1 vector and derives severity', () => {
    expect(
      resolveOsvRow({
        id: 'a',
        severities: [{ type: 'CVSS_V3', score: V31_CRITICAL }],
        label: null,
      }),
    ).toEqual({
      id: 'a',
      score: 9.8,
      vector: V31_CRITICAL,
      version: '3.1',
      severity: 'CRITICAL',
    });
  });

  it('prefers a scored 3.1 vector over a scored 2.0 vector', () => {
    const row = resolveOsvRow({
      id: 'b',
      severities: [
        { type: 'CVSS_V2', score: V2_MEDIUM },
        { type: 'CVSS_V3', score: V31_CRITICAL },
      ],
      label: null,
    });
    expect(row?.version).toBe('3.1');
    expect(row?.severity).toBe('CRITICAL');
  });

  it('resolves label-only rows, normalising MODERATE to MEDIUM', () => {
    expect(
      resolveOsvRow({ id: 'c', severities: null, label: 'MODERATE' }),
    ).toEqual({
      id: 'c',
      score: null,
      vector: null,
      version: null,
      severity: 'MEDIUM',
    });
  });

  it('keeps an unscored 4.0 vector and falls back to the label', () => {
    expect(
      resolveOsvRow({
        id: 'd',
        severities: [{ type: 'CVSS_V4', score: V4 }],
        label: 'high',
      }),
    ).toEqual({
      id: 'd',
      score: null,
      vector: V4,
      version: '4.0',
      severity: 'HIGH',
    });
  });

  it('returns null when neither score nor label yields a severity', () => {
    expect(
      resolveOsvRow({
        id: 'e',
        severities: [{ type: 'CVSS_V3', score: 'garbage' }],
        label: 'bogus',
      }),
    ).toBeNull();
  });
});

describe('parseBackfillArgs', () => {
  it('defaults to a real run with batch 2000', () => {
    expect(parseBackfillArgs([])).toEqual({ dryRun: false, batchSize: 2000 });
  });

  it('reads --dry-run and --batch=N', () => {
    expect(parseBackfillArgs(['--dry-run', '--batch=50'])).toEqual({
      dryRun: true,
      batchSize: 50,
    });
  });

  it.each([
    '--batch=0',
    '--batch=-5',
    '--batch=abc',
    '--batch=1.5',
    '--batch=',
  ])('rejects invalid %s', (arg) => {
    expect(() => parseBackfillArgs([arg])).toThrow(/--batch/);
  });
});

describe('runOsvSeverityBackfill', () => {
  const row = (
    id: string,
    label: string | null = 'HIGH',
    severities = null,
  ) => ({
    id,
    severities,
    label,
  });

  function makePrisma(pages: any[][]) {
    const queue = [...pages];
    return {
      $queryRaw: jest.fn().mockImplementation(async () => queue.shift() ?? []),
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
  }

  it('dry run never calls $executeRaw but reports the plan', async () => {
    const prisma = makePrisma([[row('a'), row('b')]]);
    const log = jest.fn();

    const stats = await runOsvSeverityBackfill(prisma as any, {
      dryRun: true,
      batchSize: 10,
      log,
    });

    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ seen: 2, resolved: 2, written: 0 });
    expect(log.mock.calls.flat().join('\n')).toMatch(/dry-run/i);
  });

  it('advances the cursor by the last id of each page', async () => {
    const prisma = makePrisma([[row('a'), row('b')], [row('c')], []]);

    const stats = await runOsvSeverityBackfill(prisma as any, {
      dryRun: false,
      batchSize: 2,
      log: jest.fn(),
    });

    const cursors = prisma.$queryRaw.mock.calls.map((c) => c[1]);
    expect(cursors).toEqual(['', 'b', 'c']);
    expect(prisma.$queryRaw.mock.calls[0][2]).toBe(2);
    expect(prisma.$executeRaw).toHaveBeenCalledTimes(2);
    expect(stats).toMatchObject({ seen: 3, resolved: 3, written: 3 });
  });

  it('writes label-only rows and skips unresolvable ones', async () => {
    const prisma = makePrisma([[row('a', 'MODERATE'), row('b', null)], []]);

    const stats = await runOsvSeverityBackfill(prisma as any, {
      dryRun: false,
      batchSize: 5,
      log: jest.fn(),
    });

    expect(prisma.$executeRaw).toHaveBeenCalledTimes(1);
    const args = prisma.$executeRaw.mock.calls[0];
    expect(args[1]).toEqual(['a']);
    expect(args[2]).toEqual(['MEDIUM']);
    expect(stats).toMatchObject({
      seen: 2,
      resolved: 1,
      unresolved: 1,
      written: 1,
      byVersion: { 'label-only': 1 },
    });
  });

  it('never writes updatedAt and never overwrites existing cvss values', async () => {
    const prisma = makePrisma([[row('a')], []]);

    await runOsvSeverityBackfill(prisma as any, {
      dryRun: false,
      batchSize: 5,
      log: jest.fn(),
    });

    const sql = (prisma.$executeRaw.mock.calls[0][0] as string[]).join('?');
    expect(sql).not.toContain('updatedAt');
    expect(sql).toContain('COALESCE(vuln_cves."cvssScore"');
    expect(sql).toContain('COALESCE(vuln_cves."cvssVector"');
    expect(sql).toContain('COALESCE(vuln_cves."cvssVersion"');
    const select = (prisma.$queryRaw.mock.calls[0][0] as string[]).join('?');
    expect(select).toContain('severity IS NULL');
  });

  it('a second run over an already-filled table writes nothing', async () => {
    // Filled rows no longer match "severity IS NULL", so the query is empty.
    const prisma = makePrisma([[]]);

    const stats = await runOsvSeverityBackfill(prisma as any, {
      dryRun: false,
      batchSize: 5,
      log: jest.fn(),
    });

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(prisma.$executeRaw).not.toHaveBeenCalled();
    expect(stats).toMatchObject({ seen: 0, resolved: 0, written: 0 });
  });

  it('rejects an invalid batch size before touching the database', async () => {
    const prisma = makePrisma([]);

    await expect(
      runOsvSeverityBackfill(prisma as any, {
        dryRun: false,
        batchSize: 0,
        log: jest.fn(),
      }),
    ).rejects.toThrow(/batch/i);
    expect(prisma.$queryRaw).not.toHaveBeenCalled();
  });
});
