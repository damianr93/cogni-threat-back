import { Readable } from 'stream';
import { of } from 'rxjs';
import { OsvCollector } from './osv.collector';
import { makeCveRepo, makeSyncStateRepository } from '@test/helpers/mock-collector-deps';

function csvLines(count: number, baseDate = '2024-06-15T12:00:00Z'): string[] {
  return Array.from({ length: count }, (_, i) => {
    const day = String(15 - Math.floor(i / 50)).padStart(2, '0');
    return `2024-06-${day}T12:00:00Z,PyPI/OSV-2024-${i + 1}`;
  }).reverse();
}

function makeOsvHttp(csv: string[], detailFactory?: (id: string) => unknown) {
  let detailCalls = 0;
  return {
    get: jest.fn().mockImplementation((url: string) => {
      if (url.includes('modified_id.csv')) {
        return of({ data: Readable.from(csv.join('\n')) });
      }
      const id = url.split('/').pop()!;
      detailCalls++;
      if (detailFactory) {
        const detail = detailFactory(id);
        if (detail instanceof Error) return Promise.reject(detail).then(() => of({ data: null }));
      }
      return of({
        data: {
          id,
          modified: '2024-06-15T12:00:00Z',
          aliases: [`CVE-2024-${detailCalls}`],
          summary: 'test',
        },
      });
    }),
    detailCalls: () => detailCalls,
  };
}

describe('OsvCollector', () => {
  beforeEach(() => {
    jest.spyOn(OsvCollector.prototype as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('checkpoints every 200 IDs during full sync', async () => {
    const { repo: syncState } = makeSyncStateRepository();
    const { cveRepo } = makeCveRepo();
    const http = makeOsvHttp(csvLines(450));
    const collector = new OsvCollector(http as never, cveRepo as never, syncState);
    const markProgress = jest.spyOn(syncState, 'markProgress');
    const markSuccess = jest.spyOn(syncState, 'markSuccess');

    await collector.sync();

    expect(markProgress).toHaveBeenCalledTimes(2);
    expect(markSuccess).toHaveBeenCalledTimes(1);
  });

  it('leaves watermark at last checkpoint when processing fails mid-run', async () => {
    const { repo: syncState, store } = makeSyncStateRepository();
    const { cveRepo, upsert } = makeCveRepo();
    let calls = 0;
    upsert.mockImplementation(async () => {
      calls++;
      if (calls === 250) throw new Error('db error');
      return { isNew: true };
    });

    const http = makeOsvHttp(csvLines(450));
    const collector = new OsvCollector(http as never, cveRepo as never, syncState);

    await collector.sync();

    const row = store.rows.get('osv')!;
    expect(row.lastSyncAt).not.toBeNull();
    expect(row.lastError).toContain('db error');
  });

  it('skips intermediate checkpoints when maxItems is set', async () => {
    const { repo: syncState } = makeSyncStateRepository();
    const { cveRepo } = makeCveRepo();
    const http = makeOsvHttp(csvLines(450));
    const collector = new OsvCollector(http as never, cveRepo as never, syncState);
    const markProgress = jest.spyOn(syncState, 'markProgress');

    await collector.sync({ maxItems: 500 });

    expect(markProgress).not.toHaveBeenCalled();
  });
});

describe('OsvCollector severity mapping', () => {
  const V31_CRITICAL = 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  const V31_LOW = 'CVSS:3.1/AV:L/AC:H/PR:H/UI:R/S:U/C:L/I:N/A:N';
  const V30_HIGH = 'CVSS:3.0/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:H';
  const V2_HIGH = 'AV:N/AC:L/Au:N/C:P/I:P/A:P';
  const V4 = 'CVSS:4.0/AV:N/AC:L/AT:N/PR:N/UI:N/VC:H/VI:H/VA:H/SC:N/SI:N/SA:N';

  const map = (vuln: unknown) =>
    (
      new OsvCollector({} as never, {} as never, {} as never) as any
    ).mapOsv(vuln);

  it('derives score, version and severity from a CVSS 3.1 vector', () => {
    const mapped = map({
      id: 'GHSA-xxxx',
      aliases: ['CVE-2024-1111'],
      severity: [{ type: 'CVSS_V3', score: V31_CRITICAL }],
    });

    expect(mapped.cvssScore).toBe(9.8);
    expect(mapped.cvssVersion).toBe('3.1');
    expect(mapped.cvssVector).toBe(V31_CRITICAL);
    expect(mapped.severity).toBe('CRITICAL');
  });

  it('prefers a scored 3.1 vector over other published vectors', () => {
    const mapped = map({
      id: 'OSV-1',
      severity: [
        { type: 'CVSS_V2', score: V2_HIGH },
        { type: 'CVSS_V3', score: V30_HIGH },
        { type: 'CVSS_V3', score: V31_LOW },
      ],
    });

    expect(mapped.cvssVersion).toBe('3.1');
    expect(mapped.cvssScore).toBe(1.8);
    expect(mapped.severity).toBe('LOW');
  });

  it('falls back to any scored vector when no 3.1 vector can be scored', () => {
    const mapped = map({
      id: 'OSV-2',
      severity: [
        { type: 'CVSS_V4', score: V4 },
        { type: 'CVSS_V2', score: V2_HIGH },
      ],
    });

    expect(mapped.cvssVersion).toBe('2.0');
    expect(mapped.cvssScore).toBe(7.5);
    expect(mapped.severity).toBe('HIGH');
  });

  it('keeps a CVSS 4.0 vector visible although it is not scored', () => {
    const mapped = map({ id: 'OSV-3', severity: [{ type: 'CVSS_V4', score: V4 }] });

    expect(mapped.cvssVector).toBe(V4);
    expect(mapped.cvssVersion).toBe('4.0');
    expect(mapped.cvssScore).toBeNull();
    expect(mapped.severity).toBeNull();
  });

  it('uses the database_specific label when no vector can be scored', () => {
    const mapped = map({
      id: 'OSV-4',
      severity: [{ type: 'CVSS_V4', score: V4 }],
      database_specific: { severity: ' high ' },
    });

    expect(mapped.cvssScore).toBeNull();
    expect(mapped.severity).toBe('HIGH');
  });

  it('uses the label when there is no vector at all', () => {
    const mapped = map({
      id: 'OSV-5',
      database_specific: { severity: 'MODERATE' },
    });

    expect(mapped.cvssVector).toBeNull();
    expect(mapped.severity).toBe('MEDIUM');
  });

  it('prefers the vector-derived severity over the label', () => {
    const mapped = map({
      id: 'OSV-6',
      severity: [{ type: 'CVSS_V3', score: V31_CRITICAL }],
      database_specific: { severity: 'LOW' },
    });

    expect(mapped.severity).toBe('CRITICAL');
  });

  it('leaves severity null for a malformed vector without a label', () => {
    const mapped = map({
      id: 'OSV-7',
      severity: [{ type: 'CVSS_V3', score: 'garbage/not-a-vector' }],
    });

    expect(mapped.cvssScore).toBeNull();
    expect(mapped.cvssVector).toBeNull();
    expect(mapped.cvssVersion).toBeNull();
    expect(mapped.severity).toBeNull();
  });

  it('ignores an unrecognised label and a non-string vector', () => {
    const mapped = map({
      id: 'OSV-8',
      severity: [{ type: 'CVSS_V3', score: 9.8 }],
      database_specific: { severity: 'spicy' },
    });

    expect(mapped.severity).toBeNull();
  });

  it('leaves everything null when the advisory carries no severity data', () => {
    const mapped = map({ id: 'OSV-9', summary: 'no severity here' });

    expect(mapped.cvssScore).toBeNull();
    expect(mapped.cvssVersion).toBeNull();
    expect(mapped.severity).toBeNull();
  });

  it('still ingests an advisory whose vector is malformed', async () => {
    jest
      .spyOn(OsvCollector.prototype as any, 'sleep')
      .mockResolvedValue(undefined);
    const { repo: syncState } = makeSyncStateRepository();
    const { cveRepo, upsert } = makeCveRepo();
    const http = {
      get: jest.fn().mockImplementation((url: string) =>
        of(
          url.includes('modified_id.csv')
            ? { data: Readable.from(csvLines(1).join('\n')) }
            : {
                data: {
                  id: 'OSV-2024-1',
                  aliases: ['CVE-2024-9'],
                  severity: [{ type: 'CVSS_V3', score: 'garbage' }],
                },
              },
        ),
      ),
    };
    const collector = new OsvCollector(
      http as never,
      cveRepo as never,
      syncState,
    );

    const result = await collector.sync();

    expect(result.errors).toEqual([]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0]).toMatchObject({
      cveId: 'CVE-2024-9',
      cvssScore: null,
      severity: null,
    });
  });
});
