import { Readable } from 'stream';
import * as zlib from 'zlib';
import { of, throwError } from 'rxjs';
import { EpssCollector } from './epss.collector';
import {
  makeCveRepo,
  makeSyncStateRepository,
} from '@test/helpers/mock-collector-deps';

const CSV = [
  '#model_version:v2025.03.14,score_date:2026-06-05T00:00:00Z',
  'cve,epss,percentile',
  'CVE-2024-0001,0.5,0.9',
  'CVE-2024-0002,0.1,0.2',
].join('\n');

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { response: { status } });
}

describe('EpssCollector', () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] });
    jest.setSystemTime(new Date('2026-06-05T03:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  /** Each entry is a status code (failure) or 'ok' (published file). */
  function makeCollector(outcomes: Array<number | 'ok' | Error>) {
    const queue = [...outcomes];
    const get = jest.fn().mockImplementation(() => {
      const next = queue.shift();
      if (next === 'ok') {
        return of({ data: Readable.from([zlib.gzipSync(CSV)]) });
      }
      if (next instanceof Error) return throwError(() => next);
      return throwError(() => httpError(next as number));
    });
    const { repo: syncState } = makeSyncStateRepository();
    const { cveRepo, bulkUpdateEpss } = makeCveRepo();
    const markError = jest.spyOn(syncState, 'markError');
    const markSuccess = jest.spyOn(syncState, 'markSuccess');
    const collector = new EpssCollector(
      { get } as never,
      cveRepo as never,
      syncState,
    );
    return { collector, get, bulkUpdateEpss, markError, markSuccess };
  }

  const urlOf = (get: jest.Mock, call: number) =>
    get.mock.calls[call][0] as string;

  it('uses today file when it is published', async () => {
    const { collector, get, bulkUpdateEpss, markSuccess } = makeCollector([
      'ok',
    ]);

    const result = await collector.sync();

    expect(get).toHaveBeenCalledTimes(1);
    expect(urlOf(get, 0)).toContain('epss_scores-2026-06-05.csv.gz');
    expect(bulkUpdateEpss).toHaveBeenCalledTimes(1);
    expect(result.updatedItems).toBe(2);
    expect(markSuccess).toHaveBeenCalledWith('epss', 2);
  });

  it('falls back to the previous day when today is not published (403)', async () => {
    const { collector, get, bulkUpdateEpss } = makeCollector([403, 'ok']);

    const result = await collector.sync();

    expect(get).toHaveBeenCalledTimes(2);
    expect(urlOf(get, 1)).toContain('epss_scores-2026-06-04.csv.gz');
    expect(bulkUpdateEpss).toHaveBeenCalled();
    expect(result.errors).toEqual([]);
  });

  it('treats 404 as not published and keeps walking back', async () => {
    const { collector, get } = makeCollector([404, 403, 'ok']);

    await collector.sync();

    expect(get).toHaveBeenCalledTimes(3);
    expect(urlOf(get, 2)).toContain('epss_scores-2026-06-03.csv.gz');
  });

  it('calls markError after exhausting days 0..5', async () => {
    const { collector, get, markError, bulkUpdateEpss } = makeCollector([
      403, 404, 403, 404, 403, 404,
    ]);

    const result = await collector.sync();

    expect(get).toHaveBeenCalledTimes(6);
    expect(urlOf(get, 5)).toContain('epss_scores-2026-05-31.csv.gz');
    expect(markError).toHaveBeenCalledTimes(1);
    expect(bulkUpdateEpss).not.toHaveBeenCalled();
    expect(result.errors).toHaveLength(1);
  });

  it('does not walk back on other errors', async () => {
    const { collector, get, markError, bulkUpdateEpss } = makeCollector([
      500,
      'ok',
    ]);

    const result = await collector.sync();

    expect(get).toHaveBeenCalledTimes(1);
    expect(markError).toHaveBeenCalledTimes(1);
    expect(bulkUpdateEpss).not.toHaveBeenCalled();
    expect(result.errors[0]).toContain('EPSS sync failed');
  });
});
