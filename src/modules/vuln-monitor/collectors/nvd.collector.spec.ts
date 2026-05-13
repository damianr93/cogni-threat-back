import { NvdCollector } from './nvd.collector';
import { makeCveRepo, makeSecrets, makeSyncStateRepository } from '@test/helpers/mock-collector-deps';
import { mockHttpGet, nvdCve, nvdPageResponse } from '@test/helpers/mock-http.service';

describe('NvdCollector', () => {
  beforeEach(() => {
    jest.spyOn(NvdCollector.prototype as any, 'sleep').mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  function makeCollector(opts: {
    lastSync?: Date | null;
    httpResponses?: unknown[];
    since?: Date;
  } = {}) {
    const { repo: syncState } = makeSyncStateRepository(
      opts.lastSync != null ? { nvd: { lastSyncAt: opts.lastSync } } : {},
    );
    const { cveRepo, upsert } = makeCveRepo();
    const http = mockHttpGet(opts.httpResponses ?? [nvdPageResponse([nvdCve('CVE-2024-0001')])]);
    const secrets = makeSecrets();
    const collector = new NvdCollector(http as never, cveRepo as never, syncState, secrets as never);
    return { collector, syncState, upsert, http };
  }

  it('uses a single HTTP range for a 5-day gap', async () => {
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-06T00:00:00.000Z'));
    const { collector, http } = makeCollector({ lastSync });

    await collector.sync();

    expect(http.get).toHaveBeenCalledTimes(1);
    const params = http.get.mock.calls[0][1].params;
    expect(params.lastModStartDate).toBe(lastSync.toISOString());
    expect(new Date(params.lastModEndDate).getTime()).toBeGreaterThan(lastSync.getTime());
  });

  it('splits a 200-day gap into multiple HTTP ranges', async () => {
    const lastSync = new Date('2024-01-01T00:00:00.000Z');
    const { collector, http } = makeCollector({
      lastSync,
      httpResponses: [
        nvdPageResponse([nvdCve('CVE-2024-0001')]),
        nvdPageResponse([nvdCve('CVE-2024-0002')]),
        nvdPageResponse([nvdCve('CVE-2024-0003')]),
      ],
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-07-20T00:00:00.000Z'));

    await collector.sync();

    expect(http.get).toHaveBeenCalledTimes(3);
    const ranges = http.get.mock.calls.map((call) => ({
      start: call[1].params.lastModStartDate,
      end: call[1].params.lastModEndDate,
    }));
    expect(ranges[0].start).toBe(lastSync.toISOString());
    expect(ranges).toHaveLength(3);

    jest.useRealTimers();
  });

  it('marks progress per chunk and stops on chunk failure', async () => {
    const lastSync = new Date('2024-01-01T00:00:00.000Z');
    const { collector, syncState } = makeCollector({
      lastSync,
      httpResponses: [
        nvdPageResponse([nvdCve('CVE-2024-0001')]),
        new Error('NVD unavailable'),
      ],
    });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-07-20T00:00:00.000Z'));

    const markProgress = jest.spyOn(syncState, 'markProgress');
    const markError = jest.spyOn(syncState, 'markError');

    const result = await collector.sync();

    expect(markProgress).toHaveBeenCalled();
    expect(markError).toHaveBeenCalled();
    expect(result.errors.length).toBeGreaterThan(0);

    jest.useRealTimers();
  });

  it('paginates within a chunk and accumulates counts', async () => {
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    const page1 = nvdPageResponse(Array.from({ length: 2000 }, (_, i) => nvdCve(`CVE-2024-${i}`)), 2500);
    const page2 = nvdPageResponse([nvdCve('CVE-2024-2500')], 2500);
    const { collector, upsert } = makeCollector({ lastSync, httpResponses: [page1, page2] });

    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-05T00:00:00.000Z'));

    const result = await collector.sync();

    expect(upsert).toHaveBeenCalledTimes(2001);
    expect(result.newItems + result.updatedItems).toBe(2001);

    jest.useRealTimers();
  });

  it('honours explicit since parameter for backfill', async () => {
    const lastSync = new Date('2024-06-01T00:00:00.000Z');
    const since = new Date('2024-03-01T00:00:00.000Z');
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2024-06-05T00:00:00.000Z'));
    const { collector, http } = makeCollector({ lastSync });

    await collector.sync(since);

    const params = http.get.mock.calls[0][1].params;
    expect(params.lastModStartDate).toBe(since.toISOString());
  });
});
