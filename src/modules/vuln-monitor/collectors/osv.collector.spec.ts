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
